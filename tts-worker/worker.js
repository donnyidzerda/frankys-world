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

async function handleSync(req, env, parts) {
  if (!env.SYNC) return J({ error: "sync_not_configured" }, 500);
  const sub = parts[1] || "";

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

  return J({ error: "not_found" }, 404);
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const { pathname, searchParams } = new URL(req.url);
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "sync") return handleSync(req, env, parts);
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

    // DEFAULT: every line - chat AND teach - speaks through ElevenLabs with
    // Loïs's cloned voice (the children's mother). Hearing mama for praise
    // AND for letter sounds is the strongest possible recognition + motivation
    // anchor for a toddler. OpenAI remains as automatic fallback: if Eleven
    // is rate-limited, down, or returns any error, we silently retry on
    // OpenAI so the child never goes silent.
    // TEACH-MODE CAVEAT: stretched phonemes ("mmmaaan", "ssss") may pick up
    // a small schwa in a cloned voice that OpenAI's instruction-following
    // can suppress. Listen for it; if a letter sounds wrong, fall back to
    // teach=OpenAI for that subset via PRONOUNCE or a per-route override.
    if (env.ELEVENLABS_API_KEY) {
      const voiceId = "NR28ewDldNdNH9MMUJP2";   // Loïs - mother's cloned voice
      try {
        // Teach mode: steadier + slower so stretched phonemes don't drift
        // into expressiveness and a 3-year-old has time to track each
        // sound. Chat mode: warmer, expressive, near-natural pace.
        const settings = teach
          ? { stability: 0.7,  similarity_boost: 0.85, style: 0.1, use_speaker_boost: true, speed: slow ? 0.7  : 0.8  }
          : { stability: 0.45, similarity_boost: 0.8,  style: 0.3, use_speaker_boost: true, speed: slow ? 0.85 : 0.95 };
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
