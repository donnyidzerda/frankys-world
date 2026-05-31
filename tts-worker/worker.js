/* =========================================================================
   Franky's World - TTS proxy (Cloudflare Worker)

   Holds the OpenAI API key as an encrypted secret (NEVER in the app or
   the repo) and turns short text into a warm, gentle child-friendly MP3
   using OpenAI's gpt-4o-mini-tts. The browser caches each phrase, so a
   given line is generated once and then replays free and offline.

   Deploy: see README.md in this folder.
   ========================================================================= */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/* -------------------------------------------------------------------------
   Cross-device sync (KV-backed). No accounts: every child profile gets a
   long random sync-id (stored locally on each paired device) and a short
   6-digit pair-code that expires after 15 minutes or first use. The Worker
   only ever sees opaque JSON blobs keyed by sync-id - no email, no auth.
   Conflict policy: last-write-wins by client timestamp.
   ------------------------------------------------------------------------- */
const J = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const newId = () => {
  // 16 random bytes -> 32-char hex. Unguessable, never displayed to a child.
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
};
const newCode = () => {
  // 6 random digits. Short enough to read aloud to grandma.
  const b = new Uint32Array(1); crypto.getRandomValues(b);
  return String(b[0] % 1_000_000).padStart(6, "0");
};

/* -------------------------------------------------------------------------
   Grow-only merge. A child's learning state is naturally monotonic - stars
   only climb, mastery boxes only climb, the completed/sticker sets only
   grow. So we merge field-by-field instead of last-write-wins on the whole
   blob: numbers take the max, count-maps take per-key max, sets union, and
   only true profile metadata (name, age, settings...) uses LWW by timestamp.
   This is conflict-free: four devices can edit offline and reconcile with
   zero progress lost. MUST stay mirrored with mergeState() in index.html.
   ------------------------------------------------------------------------- */
const SYNC_MAXNUM = ["stars", "worldSeenStars", "readIntro", "mathIntro", "frankyLevel", "buddyLevel"];
const SYNC_MAXMAP = ["readBox", "readProd", "completed", "mathBox"];
const SYNC_UNION  = ["stickers"];
const SYNC_KEEP   = new Set(["syncId", "syncTs", "id"]);   // never merged from remote
function mergeState(local, remote, localTs, remoteTs) {
  local = local || {}; remote = remote || {};
  const remoteNewer = (remoteTs || 0) > (localTs || 0);
  const out = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const k of keys) {
    if (SYNC_KEEP.has(k)) { out[k] = local[k]; continue; }
    const lv = local[k], rv = remote[k];
    if (SYNC_MAXNUM.includes(k)) {
      out[k] = Math.max(+lv || 0, +rv || 0);
    } else if (SYNC_MAXMAP.includes(k)) {
      const m = Object.assign({}, lv || {});
      const r = rv || {};
      for (const kk in r) m[kk] = Math.max(+m[kk] || 0, +r[kk] || 0);
      out[k] = m;
    } else if (SYNC_UNION.includes(k)) {
      out[k] = [...new Set([
        ...(Array.isArray(lv) ? lv : []),
        ...(Array.isArray(rv) ? rv : []),
      ])];
    } else {
      // LWW: newer timestamp wins; undefined side yields to the other.
      if (rv === undefined) out[k] = lv;
      else if (lv === undefined) out[k] = rv;
      else out[k] = remoteNewer ? rv : lv;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------
   ProfileRoom - one Durable Object per profile (id = syncId). All of a
   child's devices hold a WebSocket open to their room. An edit on any device
   is merged into the authoritative state and pushed to every other device
   in real time. The DO hibernates when idle (WebSocket Hibernation API), so
   millions of profiles cost nothing until active. State is written through
   to KV (debounced via alarm) so the pair-code flow keeps returning fresh
   data and the /get fallback still works when WebSockets are blocked.
   ------------------------------------------------------------------------- */
export class ProfileRoom {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const id = url.searchParams.get("id") || "";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);          // hibernatable
    if (id) await this.state.storage.put("kvid", id);

    // Load (or lazily seed from KV) and send the current snapshot.
    let cur = await this.state.storage.get("state");
    if (!cur) {
      let seed = null;
      try {
        const raw = id && await this.env.SYNC.get("id:" + id);
        if (raw) { const d = JSON.parse(raw); seed = { state: d.json || {}, ts: d.ts || 0 }; }
      } catch {}
      cur = seed || { state: {}, ts: 0 };
      await this.state.storage.put("state", cur);
    }
    try { server.send(JSON.stringify({ type: "snapshot", state: cur.state, ts: cur.ts })); } catch {}
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === "ping") { try { ws.send('{"type":"pong"}'); } catch {} return; }
    if (m.type !== "patch" || !m.state || typeof m.state !== "object") return;

    const cur = (await this.state.storage.get("state")) || { state: {}, ts: 0 };
    const merged = mergeState(cur.state, m.state, cur.ts, m.ts);
    const ts = Math.max(cur.ts || 0, m.ts || 0);
    await this.state.storage.put("state", { state: merged, ts });

    // Broadcast merged state to every connected device (sender included -
    // the merge is idempotent, and the ack lets a client confirm its push).
    const out = JSON.stringify({ type: "sync", state: merged, ts });
    for (const s of this.state.getWebSockets()) { try { s.send(out); } catch {} }

    // Debounced write-through to KV so pairing + /get stay fresh.
    const a = await this.state.storage.getAlarm();
    if (a == null) this.state.storage.setAlarm(Date.now() + 5000);
  }

  async webSocketClose(ws) { try { ws.close(); } catch {} }
  async webSocketError() {}

  async alarm() {
    const cur = await this.state.storage.get("state");
    const id = await this.state.storage.get("kvid");
    if (cur && id) {
      try { await this.env.SYNC.put("id:" + id, JSON.stringify({ json: cur.state, ts: cur.ts })); } catch {}
    }
  }
}

async function handleSync(req, env, parts) {
  if (!env.SYNC) return J({ error: "sync_not_configured" }, 500);
  const sub = parts[1] || "";

  // GET /sync/ws?id=...  (WebSocket upgrade) -> routed to the profile's
  // Durable Object for real-time, push-based sync.
  if (sub === "ws") {
    if (!env.PROFILE) return J({ error: "realtime_not_configured" }, 500);
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!/^[a-f0-9]{32}$/.test(id)) return J({ error: "bad_id" }, 400);
    const stub = env.PROFILE.get(env.PROFILE.idFromName(id));
    return stub.fetch(req);
  }

  // POST /sync/new  -> { id, code }
  // Create a fresh blank profile slot and a short pair-code that aliases
  // to it. Code is one-shot, dies after 15 minutes.
  if (sub === "new" && req.method === "POST") {
    const id = newId();
    let code = newCode();
    // Vanishingly unlikely collision; retry up to 5 times anyway.
    for (let i = 0; i < 5 && await env.SYNC.get("pair:" + code); i++) code = newCode();
    await env.SYNC.put("id:" + id, JSON.stringify({ json: null, ts: 0 }));
    await env.SYNC.put("pair:" + code, id, { expirationTtl: 900 });   // 15 min
    return J({ id, code });
  }

  // POST /sync/code  { id }  -> { code }
  // Mint another pair-code for an already-linked profile (so a third
  // device can be added later from a device that already has the id).
  if (sub === "code" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || "");
    if (!/^[a-f0-9]{32}$/.test(id)) return J({ error: "bad_id" }, 400);
    if (!(await env.SYNC.get("id:" + id))) return J({ error: "unknown" }, 404);
    let code = newCode();
    for (let i = 0; i < 5 && await env.SYNC.get("pair:" + code); i++) code = newCode();
    await env.SYNC.put("pair:" + code, id, { expirationTtl: 900 });
    return J({ code });
  }

  // POST /sync/pair  { code }  -> { id, json, ts }
  // Redeem a pair-code on a new device. Burns the code on success.
  if (sub === "pair" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const code = String(body.code || "").replace(/\D/g, "");
    if (code.length !== 6) return J({ error: "bad_code" }, 400);
    const id = await env.SYNC.get("pair:" + code);
    if (!id) return J({ error: "expired" }, 404);
    const raw = await env.SYNC.get("id:" + id);
    if (!raw) return J({ error: "missing" }, 404);
    await env.SYNC.delete("pair:" + code);   // one-shot
    const data = JSON.parse(raw);
    return J({ id, json: data.json, ts: data.ts });
  }

  // GET /sync/get?id=...  -> { json, ts }
  if (sub === "get" && req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!/^[a-f0-9]{32}$/.test(id)) return J({ error: "bad_id" }, 400);
    const raw = await env.SYNC.get("id:" + id);
    if (!raw) return J({ error: "unknown" }, 404);
    return J(JSON.parse(raw));
  }

  // PUT /sync/put  { id, json, ts }  -> { ts } | 409 if stale
  if (sub === "put" && req.method === "PUT") {
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || "");
    const ts = Number(body.ts) || Date.now();
    if (!/^[a-f0-9]{32}$/.test(id)) return J({ error: "bad_id" }, 400);
    if (!body.json || typeof body.json !== "object") return J({ error: "bad_json" }, 400);
    const blob = JSON.stringify(body.json);
    if (blob.length > 50_000) return J({ error: "too_big" }, 413);   // 50 KB cap
    const cur = await env.SYNC.get("id:" + id);
    if (!cur) return J({ error: "unknown" }, 404);
    const prev = JSON.parse(cur);
    if (prev.ts && ts < prev.ts - 1) {
      // Client is older than server; client should pull, merge, retry.
      return J({ error: "stale", ts: prev.ts }, 409);
    }
    await env.SYNC.put("id:" + id, JSON.stringify({ json: body.json, ts }));
    return J({ ts });
  }

  // POST /sync/delete { id }  -> erase this family's cloud data (GDPR erasure).
  // Removes the synced learning state AND the entitlement record. (Stripe
  // cancellation, if any, is handled separately via the customer portal.)
  if (sub === "delete" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || "");
    if (!/^[a-f0-9]{32}$/.test(id)) return J({ error: "bad_id" }, 400);
    try { await env.SYNC.delete("id:" + id); } catch {}
    try { await env.SYNC.delete("ent:" + id); } catch {}
    return J({ ok: true });
  }

  return J({ error: "not_found" }, 404);
}

/* =========================================================================
   Billing (Paddle Billing) + entitlement. Paddle is the Merchant of Record -
   it handles global VAT/sales tax for us. Checkout runs CLIENT-SIDE via
   Paddle.js (overlay) in the app, passing custom_data.sync_id. This Worker
   handles the server side: the signed webhook sets the entitlement in the same
   KV the sync uses (keyed by the sync account id), and /billing/portal opens
   the Paddle customer portal. /entitlement is read + cached by the app. All
   fails closed to "free" if not configured.

   Required (wrangler secret put ...):
     PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET
   Optional var: PADDLE_ENV = "sandbox" | "production" (default production)
   ========================================================================= */
const paddleApiBase = env =>
  (env.PADDLE_ENV === "sandbox") ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
async function getEnt(env, id) {
  try { const raw = await env.SYNC.get("ent:" + id); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
async function setEnt(env, id, patch) {
  const next = Object.assign((await getEnt(env, id)) || {}, patch);
  await env.SYNC.put("ent:" + id, JSON.stringify(next));
  return next;
}
async function entitlementGet(env, sp) {
  const id = sp.get("id");
  const ent = id ? await getEnt(env, id) : null;
  const premium = !!(ent && ent.premium && (+ent.until || 0) > Date.now());
  return J({ premium, until: ent ? (+ent.until || 0) : 0, plan: ent ? (ent.plan || "") : "" });
}
async function handleBilling(req, env, parts, sp) {
  const sub = parts[1];
  if (sub === "webhook") return billingWebhook(req, env);
  // checkout is client-side (Paddle.js); nothing to do server-side.
  if (sub === "checkout") return J({ note: "client-side via Paddle.js" });
  if (sub === "portal")   return billingPortal(env, sp);
  return new Response("ok", { headers: CORS });
}
// Open the Paddle customer portal for this family's stored Paddle customer.
async function billingPortal(env, sp) {
  const id = sp.get("id"), ret = sp.get("return") || "https://frankysworld.skep.co/";
  if (!id) return new Response("bad request", { status: 400, headers: CORS });
  const ent = await getEnt(env, id);
  if (!env.PADDLE_API_KEY || !ent || !ent.customer) return Response.redirect(ret, 303);
  try {
    const r = await fetch(paddleApiBase(env) + "/customers/" + ent.customer + "/portal-sessions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.PADDLE_API_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => ({}));
    const url = j && j.data && j.data.urls && j.data.urls.general && j.data.urls.general.overview;
    return Response.redirect(url || ret, 303);
  } catch { return Response.redirect(ret, 303); }
}
// Verify a Paddle webhook signature. Header: "ts=...;h1=<hex hmac>".
// Signed payload is `${ts}:${rawBody}`, HMAC-SHA256 with the secret. 5-min skew.
async function verifyPaddle(payload, sigHeader, secret) {
  try {
    const map = Object.fromEntries(String(sigHeader).split(";").map(kv => kv.split("=")));
    const t = map.ts, h1 = map.h1;
    if (!t || !h1) return false;
    if (Math.abs(Date.now() / 1000 - (+t)) > 300) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(t + ":" + payload));
    const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
    if (hex.length !== h1.length) return false;
    let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ h1.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}
async function billingWebhook(req, env) {
  const sig = req.headers.get("paddle-signature") || "";
  const payload = await req.text();
  if (!env.PADDLE_WEBHOOK_SECRET || !(await verifyPaddle(payload, sig, env.PADDLE_WEBHOOK_SECRET)))
    return new Response("bad signature", { status: 400 });
  let evt; try { evt = JSON.parse(payload); } catch { return new Response("bad json", { status: 400 }); }
  const type = evt.event_type || "";
  const d = evt.data || {};
  const cd = d.custom_data || {};
  const id = cd.sync_id || cd.syncId;
  const FAR = Date.now() + 100 * 365 * 24 * 3600 * 1000;   // ~forever (lifetime)
  const GRACE = Date.now() + 8 * 24 * 3600 * 1000;         // provisional window
  const ts = s => { const t = Date.parse(s || ""); return isNaN(t) ? 0 : t; };
  try {
    if (id) {
      if (type === "transaction.completed") {
        // One-time purchase (lifetime). Subscriptions are handled by the
        // subscription.* events, so only grant lifetime here.
        if (cd.plan === "lifetime")
          await setEnt(env, id, { premium: true, until: FAR, plan: "lifetime", customer: d.customer_id || undefined });
      } else if (type.indexOf("subscription.") === 0) {
        // status: active | trialing | past_due | paused | canceled
        const s = d.status;
        const ends = ts(d.current_billing_period && d.current_billing_period.ends_at);
        const premium = ["active", "trialing", "past_due"].includes(s);
        await setEnt(env, id, {
          premium, until: premium ? (ends || GRACE) : 0, plan: "sub",
          customer: d.customer_id || undefined,
        });
      }
    }
  } catch {}
  return new Response("ok", { status: 200 });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const { pathname, searchParams } = new URL(req.url);
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "sync") return handleSync(req, env, parts);
    if (parts[0] === "billing") return handleBilling(req, env, parts, searchParams);
    if (pathname === "/entitlement") return entitlementGet(env, searchParams);
    if (pathname !== "/tts") return new Response("ok", { headers: CORS });

    // Keep requests tiny and abuse-resistant: short text only.
    const text = (searchParams.get("t") || "").slice(0, 300).trim();
    if (!text) return new Response("missing text", { status: 400, headers: CORS });
    const slow = searchParams.get("s") === "1";
    // Mode: "teach" = letter sounds / words / reading (must be exact and
    // accent-free); "chat" = Franky's warm everyday speech (praise, etc.).
    const teach = searchParams.get("m") === "teach";
    const LANGS = { nl: "Dutch", en: "English", es: "Spanish" };
    const lang = LANGS[(searchParams.get("l") || "en").slice(0, 2)] || "English";

    if (!env.OPENAI_API_KEY) {
      return new Response("server not configured", { status: 500, headers: CORS });
    }

    // DEFAULT: every line - chat AND teach - speaks through ElevenLabs.
    // We use a PREMADE multilingual voice rather than an instant clone: a
    // clone trained on a few minutes of one-language audio guesses cross-
    // language phonemes and drifts (the inconsistency heard with Loïs).
    // Premade voices are curated for stable pronunciation across all the
    // eleven_multilingual_v2 languages (Dutch / English / Spanish included).
    // OpenAI stays the automatic fallback on any ElevenLabs error.
    //
    // One native-sounding voice PER LANGUAGE - far better pronunciation for
    // phonics than a single English voice speaking all three. To swap a
    // voice, change its id here and bump TTS_REV in the app.
    //   nl: Roos    - kind, articulate, standard Dutch (educational)
    //   es: Adriana - warm, calm, neutral Latin-American Spanish
    //   en: Sarah   - mature, reassuring, warm (premade)
    const VOICE_BY_LANG = {
      nl: "7qdUFMklKPaaAVMsBTBt",
      es: "jI8zlZKtaOjhGPBV6elt",
      en: "EXAVITQu4vr4xnSDxMaL",
    };
    const VOICE_ID = VOICE_BY_LANG[(searchParams.get("l") || "en").slice(0, 2)] || VOICE_BY_LANG.en;
    if (env.ELEVENLABS_API_KEY) {
      const voiceId = VOICE_ID;
      try {
        // Premade voices hold up at higher stability without going flat, so
        // teach mode can be a touch steadier for clean, repeatable phonemes.
        const settings = teach
          ? { stability: 0.6,  similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: slow ? 0.85 : 0.92 }
          : { stability: 0.5,  similarity_boost: 0.8, style: 0.3,  use_speaker_boost: true, speed: slow ? 0.9  : 1.0  };
        const r = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: {
              "xi-api-key": env.ELEVENLABS_API_KEY,
              "Content-Type": "application/json",
              "Accept": "audio/mpeg",
            },
            body: JSON.stringify({
              text,
              model_id: "eleven_multilingual_v2",
              // Hard language hint - on short ambiguous words ("slang",
              // "man", "tas") the auto-detect leans English. Forcing nl/en/es
              // here helps the multilingual model pick the right phonemes.
              language_code: (searchParams.get("l") || "en").slice(0, 2),
              // Fixed seed: same text + settings => same audio every render.
              // Removes ElevenLabs' per-call randomness so a regenerated
              // phrase sounds identical to its cached version (consistency).
              seed: 4242,
              voice_settings: settings,
            }),
          });
        if (r.ok) {
          return new Response(r.body, {
            headers: {
              ...CORS,
              "Content-Type": "audio/mpeg",
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        }
        // Fall through to OpenAI on any ElevenLabs failure.
      } catch { /* fall through to OpenAI */ }
    }

    const voice =
      "Voice: a warm, kind, calm preschool teacher speaking to a small " +
      "child aged one to five. Tone: gentle, encouraging, unhurried, and " +
      "loving. ";
    const pace = slow
      ? "Pace: very slow and clear, with soft pauses between phrases."
      : "Pace: slow and clear, never rushed.";

    let instructions;
    if (teach) {
      // TEACHING MODE - a child is learning letter sounds and how to read.
      // Pronunciation must be exact, neutral and consistent, with NO
      // regional accent of any kind.
      const RULES = {
        Dutch:
          "Language: speak entirely in clear, standard, textbook Dutch " +
          "(Standaardnederlands / Algemeen Nederlands). This audio teaches " +
          "a young child the sounds of letters and how to read simple " +
          "words, so pronunciation must be exact, neutral and consistent - " +
          "absolutely NO regional or city accent (no Amsterdam/Mokum " +
          "accent). Dutch pronunciation rules, follow strictly: " +
          "Short vowels - the short 'a' (in 'tas', 'kat', 'man', 'dak', " +
          "'lat', 'pan') is the open back /ɑ/, short, like the 'a' in " +
          "English 'father'; it must NEVER drift toward /ɛ/ (so 'tas' must " +
          "NOT sound like 'tes', 'kat' must NOT sound like 'ket'). Short " +
          "'e' is /ɛ/ (pen), short 'i' is /ɪ/ (kip), short 'o' is /ɔ/ " +
          "(pot), short 'u' is /ʏ/ (bus). " +
          "Long vowels - 'aa' /aː/, 'ee' /eː/, 'oo' /oː/ (like English " +
          "'boat', never English 'food'), 'uu' /yː/, 'oe' /u/ (like " +
          "English 'food'), 'ie' /i/, 'eu' /øː/. " +
          "Diphthongs - 'ij' and 'ei' /ɛi/, 'ui' /œy/, 'au' and 'ou' /ɑu/. " +
          "Consonants - 'g' and 'ch' are Dutch /x/; 'sch' is /sx/; 'ng' is " +
          "/ŋ/; 'c' is /k/ before a/o/u/consonant and /s/ before e/i; 'r' " +
          "is a clear Dutch r. When a single sound is stretched (for " +
          "example 'sssss' or 'mmmm'), keep it the pure consonant or vowel " +
          "with no added 'uh' schwa. ",
        English:
          "Language: speak entirely in clear, standard, neutral English " +
          "with a gentle neutral accent. This audio teaches a young child " +
          "letter sounds and early reading, so pronunciation must be " +
          "exact, neutral and consistent. Pronounce short vowels crisply: " +
          "'a' /æ/ (cat), 'e' /ɛ/ (pen), 'i' /ɪ/ (sit), 'o' /ɒ/ (pot), " +
          "'u' /ʌ/ (sun). When a sound is stretched (for example 'sssss' " +
          "or 'mmmm'), keep it the pure sound with no added 'uh' schwa. ",
        Spanish:
          "Language: speak entirely in clear, standard, neutral Spanish " +
          "with no strong regional accent. This audio teaches a young " +
          "child letter sounds and early reading. The five Spanish vowels " +
          "are pure and always identical: a /a/, e /e/, i /i/, o /o/, u " +
          "/u/. 'j' and 'g' before e/i are /x/; 'll' and 'y' are /ʝ/; 'ñ' " +
          "is /ɲ/; 'rr' is a trill; 'c' before e/i and 'z' are /s/; 'h' is " +
          "silent. When a sound is stretched, keep it pure with no added " +
          "'uh' schwa. ",
      };
      instructions = (RULES[lang] || RULES.English) + voice + pace +
        " Articulate each word a little more deliberately than usual so " +
        "the child clearly hears every individual sound.";
    } else {
      // CHATTER MODE - Franky's warm everyday voice. Dutch keeps a light,
      // friendly Amsterdam accent for personality (never on teaching).
      const accentTouch = lang === "Dutch"
        ? "Accent: a light, warm and friendly Amsterdam (Mokums) accent - " +
          "gentle everyday Amsterdam intonation, the 'r' soft and lightly " +
          "rolled, the 'g' a little softer than harsh standard Dutch. Not " +
          "a caricature, not comedic, never exaggerated - just a warm " +
          "local voice. Still perfectly clear pronunciation: keep all " +
          "vowels correct standard Dutch (do NOT shift the short 'a' " +
          "toward 'e'). 'oo' is long Dutch /oː/ like 'boat', never English " +
          "/uː/. 'aa' /aː/, 'ee' /eː/, 'uu' /yː/, 'oe' /u/. The letter " +
          "'c' is /k/ before a/o/u/consonant and /s/ before e/i. "
        : "";
      instructions =
        `Language: speak entirely in ${lang} with a natural native ` +
        `${lang} accent. Pronounce EVERY word and EVERY name using ` +
        `${lang} pronunciation rules, including names that look English ` +
        `(for example, in Dutch say the name with Dutch vowel sounds, not ` +
        `English ones). ` +
        accentTouch + voice + pace;
    }

    let r;
    try {
      r = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "coral",          // warm + friendly; try "shimmer"/"sage" too
          input: text,
          instructions,
          response_format: "mp3",
        }),
      });
    } catch {
      return new Response("upstream error", { status: 502, headers: CORS });
    }

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return new Response("tts error: " + detail.slice(0, 200),
        { status: 502, headers: CORS });
    }

    return new Response(r.body, {
      headers: {
        ...CORS,
        "Content-Type": "audio/mpeg",
        // Long cache: phrases are stable, so edge + browser reuse them.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  },
};
