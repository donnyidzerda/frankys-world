#!/usr/bin/env node
/* =========================================================================
   Franky's World — self-hosted API (Hetzner VPS edition)

   Replaces the Cloudflare Worker + Supabase for the v2 deployment:
     GET  /tts?s&m&l&v&t      neural TTS with a GENERATE-ONCE DISK CACHE —
                              every phrase is synthesized at most once per
                              voice revision, then served from disk forever,
                              for every visitor. ElevenLabs speaks chat
                              lines, OpenAI gpt-4o-mini-tts speaks teaching
                              lines (it obeys the phonics instructions).
     POST /sync/new           -> { id, code }     create profile slot + code
     POST /sync/code {id}     -> { code }         extra code for a slot
     POST /sync/pair {code}   -> { id, json, ts } redeem (one-shot, 15 min)
     GET  /sync/get?id=       -> { json, ts }
     PUT  /sync/put {id,ts,json} -> { ts } | 409  last-write-wins w/ pull
     POST /sync/delete {id}   -> { ok }           GDPR erasure
     WS   /sync/ws?id=        real-time room: client sends {type:"patch",
                              state, ts}; server grow-merges, persists and
                              broadcasts {type:"snapshot", state, ts}.
     GET  /health             -> { ok, keys, cachedClips }

   No dependencies — Node stdlib only. State is plain files under DATA_DIR
   (default /var/lib/frankys): sync/<id>.json, pair/<code>, tts/<sha>.mp3.
   Secrets come from the systemd EnvironmentFile (/etc/frankys-api.env);
   without keys /tts answers 503 and the app falls back to the device voice.

   nginx terminates TLS and proxies  /api/  ->  127.0.0.1:8787/  (prefix
   stripped), including the WebSocket upgrade.
   ========================================================================= */
"use strict";
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = +(process.env.PORT || 8787);
const DATA = process.env.DATA_DIR || "/var/lib/frankys";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || "";

for (const d of ["sync", "pair", "tts"]) fs.mkdirSync(path.join(DATA, d), { recursive: true });

/* ----- tiny helpers ----------------------------------------------------- */
const J = (res, obj, status = 200) =>
  { res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(obj)); };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const newId = () => crypto.randomBytes(16).toString("hex");           // 32 hex
const newCode = () => String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
const ipOf = (req) => (req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "0").toString().split(",")[0].trim();
function readBody(req, cap = 128 * 1024) {
  return new Promise((resolve) => {
    let buf = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > cap) { resolve(null); req.destroy(); } else buf.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(buf).toString("utf8") || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve(null));
  });
}

/* ----- per-IP rate limit (TTS only, mirrors the Worker's 120/min) ------- */
const rl = new Map();
function rateLimited(ip) {
  const bucket = ip + ":" + Math.floor(Date.now() / 60000);
  const n = (rl.get(bucket) || 0) + 1;
  rl.set(bucket, n);
  if (rl.size > 5000) { const cut = Math.floor(Date.now() / 60000); for (const k of rl.keys()) if (!k.endsWith(":" + cut)) rl.delete(k); }
  return n > 120;
}

/* ----- sync store (plain files, atomic writes) --------------------------- */
const syncPath = (id) => path.join(DATA, "sync", id + ".json");
const pairPath = (code) => path.join(DATA, "pair", code);
const ID_RE = /^[a-f0-9]{32}$/;
const PAIR_TTL = 15 * 60 * 1000;
function readSync(id) {
  try { return JSON.parse(fs.readFileSync(syncPath(id), "utf8")); } catch { return null; }
}
function writeSync(id, obj) {
  const p = syncPath(id); const tmp = p + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, p);
}
function mintCode(id) {
  let code = newCode();
  for (let i = 0; i < 5 && fs.existsSync(pairPath(code)); i++) code = newCode();
  fs.writeFileSync(pairPath(code), id);
  return code;
}
function redeemCode(code) {
  const p = pairPath(code);
  try {
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs > PAIR_TTL) { fs.unlinkSync(p); return null; }
    const id = fs.readFileSync(p, "utf8").trim();
    fs.unlinkSync(p);                                   // one-shot
    return ID_RE.test(id) ? id : null;
  } catch { return null; }
}
setInterval(() => {                                     // sweep expired codes
  try { for (const f of fs.readdirSync(path.join(DATA, "pair"))) {
    const p = path.join(DATA, "pair", f);
    try { if (Date.now() - fs.statSync(p).mtimeMs > PAIR_TTL) fs.unlinkSync(p); } catch {}
  } } catch {}
}, 10 * 60 * 1000).unref();

/* ----- grow-only merge — MUST stay mirrored with mergeState() in the app - */
const MAXNUM = ["stars", "worldSeenStars", "readIntro", "mathIntro", "frankyLevel", "buddyLevel"];
const MAXMAP = ["readBox", "readProd", "completed", "mathBox"];
const UNION = ["stickers"];
const KEEP = new Set(["syncId", "syncTs", "id"]);
function mergeState(local, remote, localTs, remoteTs) {
  local = local || {}; remote = remote || {};
  const remoteNewer = (remoteTs || 0) > (localTs || 0);
  const out = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    if (KEEP.has(k)) { out[k] = local[k]; continue; }
    const lv = local[k], rv = remote[k];
    if (MAXNUM.includes(k)) out[k] = Math.max(+lv || 0, +rv || 0);
    else if (MAXMAP.includes(k)) {
      const m = Object.assign({}, lv || {}); const r = rv || {};
      for (const kk in r) m[kk] = Math.max(+m[kk] || 0, +r[kk] || 0);
      out[k] = m;
    } else if (UNION.includes(k)) {
      out[k] = [...new Set([...(Array.isArray(lv) ? lv : []), ...(Array.isArray(rv) ? rv : [])])];
    } else {
      if (rv === undefined) out[k] = lv;
      else if (lv === undefined) out[k] = rv;
      else out[k] = remoteNewer ? rv : lv;
    }
  }
  return out;
}

/* ----- TTS (ported 1:1 from the Cloudflare Worker, plus the disk cache) -- */
const VOICE_BY_LANG = {
  nl: "7qdUFMklKPaaAVMsBTBt",   // Roos    - kind, articulate, standard Dutch
  es: "jI8zlZKtaOjhGPBV6elt",   // Adriana - warm, calm, neutral LatAm Spanish
  en: "EXAVITQu4vr4xnSDxMaL",   // Sarah   - mature, reassuring, warm
};
const TEACH_RULES = {
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
    "with no added 'uh' schwa - never say 'su-sss', 'mu-mmm' or any " +
    "vowel before/after the consonant. A single bare letter (e.g. 's', " +
    "'a', 't', 'm') must be a clipped Dutch phoneme of about half a " +
    "second, no schwa, no English letter-name. Bare digits or number " +
    "words must be the Dutch counting word ('een' said as the NUMBER " +
    "een /eːn/ with stress, never as the unstressed article; 'twee' " +
    "/tʋeː/, 'drie' /dri/, 'vier' /fir/, 'vijf' /vɛif/). ",
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
function openaiInstructions(teach, lang, slow) {
  const voice =
    "Voice: a warm, kind, calm preschool teacher speaking to a small " +
    "child aged one to five. Tone: gentle, encouraging, unhurried, and " +
    "loving. ";
  const pace = slow
    ? "Pace: very slow and clear, with soft pauses between phrases."
    : "Pace: slow and clear, never rushed.";
  if (teach) {
    return (TEACH_RULES[lang] || TEACH_RULES.English) + voice + pace +
      " Articulate each word a little more deliberately than usual so " +
      "the child clearly hears every individual sound.";
  }
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
  return (
    `Language: speak entirely in ${lang} with a natural native ` +
    `${lang} accent. Pronounce EVERY word and EVERY name using ` +
    `${lang} pronunciation rules, including names that look English ` +
    `(for example, in Dutch say the name with Dutch vowel sounds, not ` +
    `English ones). ` + accentTouch + voice + pace);
}
async function synthesize(text, { teach, slow, lc, lang }) {
  // Chat lines prefer ElevenLabs (warmer voice); teach ALWAYS uses OpenAI
  // (only it obeys the phonics instruction block). Fall through on errors.
  if (!teach && ELEVEN_KEY) {
    try {
      const r = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_BY_LANG[lc] || VOICE_BY_LANG.en}?output_format=mp3_44100_128`,
        { method: "POST",
          headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg" },
          body: JSON.stringify({
            text, model_id: "eleven_multilingual_v2", language_code: lc,
            seed: 4242,   // same text+settings => identical audio (consistency)
            voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true, speed: slow ? 0.9 : 1.0 },
          }) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* fall through to OpenAI */ }
  }
  if (!OPENAI_KEY) return null;
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts", voice: "coral", input: text,
      instructions: openaiInstructions(teach, lang, slow), response_format: "mp3",
    }) });
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}
async function handleTTS(req, res, q) {
  const text = (q.get("t") || "").slice(0, 300).trim();
  if (!text) return J(res, { error: "missing_text" }, 400);
  if (rateLimited(ipOf(req))) return J(res, { error: "rate_limited" }, 429);
  const slow = q.get("s") === "1";
  const teach = q.get("m") === "teach";
  const lc = (q.get("l") || "en").slice(0, 2);
  const lang = { nl: "Dutch", en: "English", es: "Spanish" }[lc] || "English";
  const rev = (q.get("v") || "0").slice(0, 8);

  // THE server cache: one file per unique (rev, lang, mode, pace, text) —
  // synthesized once ever, then served from disk to every visitor.
  const key = sha([rev, lc, teach ? "t" : "c", slow ? "s" : "n", text].join("|"));
  const file = path.join(DATA, "tts", key + ".mp3");
  const headers = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
    "X-TTS-Cache": "hit",
  };
  if (fs.existsSync(file)) { res.writeHead(200, headers); fs.createReadStream(file).pipe(res); return; }
  if (!OPENAI_KEY && !ELEVEN_KEY) return J(res, { error: "no_keys" }, 503);
  let audio = null;
  try { audio = await synthesize(text, { teach, slow, lc, lang }); } catch {}
  if (!audio || !audio.length) return J(res, { error: "upstream" }, 502);
  try { const tmp = file + ".tmp"; fs.writeFileSync(tmp, audio); fs.renameSync(tmp, file); } catch {}
  headers["X-TTS-Cache"] = "miss";
  res.writeHead(200, headers); res.end(audio);
}

/* ----- WebSocket: minimal RFC6455 server (text frames only) -------------- */
const rooms = new Map();                 // syncId -> Set<socket>
function wsAccept(key) {
  return crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}
function wsSend(sock, str) {
  const p = Buffer.from(str, "utf8");
  let head;
  if (p.length < 126) { head = Buffer.from([0x81, p.length]); }
  else if (p.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(p.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(p.length), 2); }
  try { sock.write(Buffer.concat([head, p])); } catch {}
}
function roomBroadcast(id, str) {
  const set = rooms.get(id); if (!set) return;
  for (const s of set) wsSend(s, str);
}
function handleUpgrade(req, sock) {
  const url = new URL(req.url, "http://x");
  const pathOk = url.pathname === "/sync/ws";
  const id = url.searchParams.get("id") || "";
  const key = req.headers["sec-websocket-key"];
  if (!pathOk || !ID_RE.test(id) || !key) { sock.destroy(); return; }
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
             "Sec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n");
  if (!rooms.has(id)) rooms.set(id, new Set());
  rooms.get(id).add(sock);
  sock.setNoDelay(true);
  // Greet with the current snapshot so a fresh device hydrates instantly.
  const cur = readSync(id);
  if (cur) wsSend(sock, JSON.stringify({ type: "snapshot", state: cur.json, ts: cur.ts || 0 }));

  let buf = Buffer.alloc(0);
  sock.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { sock.destroy(); return; }          // >64KB: never sent by the app
      if (masked && buf.length < off + 4 + len) return;
      if (!masked && buf.length < off + len) return;
      let payload;
      if (masked) {
        const mask = buf.subarray(off, off + 4); off += 4;
        payload = Buffer.from(buf.subarray(off, off + len));
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      } else payload = buf.subarray(off, off + len);
      buf = buf.subarray(off + len);
      if (op === 8) { sock.end(); return; }                      // close
      if (op === 9) { try { sock.write(Buffer.from([0x8a, 0])); } catch {} continue; }  // ping->pong
      if (op !== 1 || !fin) continue;                            // text only
      let m; try { m = JSON.parse(payload.toString("utf8")); } catch { continue; }
      if (m && m.type === "patch" && m.state && typeof m.state === "object") {
        const cur = readSync(id) || { json: null, ts: 0 };
        const ts = Math.max(+m.ts || 0, cur.ts || 0, 1);
        const merged = mergeState(cur.json, m.state, cur.ts, +m.ts || 0);
        writeSync(id, { json: merged, ts });
        roomBroadcast(id, JSON.stringify({ type: "snapshot", state: merged, ts }));
      }
      // {"type":"ping"} keep-alives need no reply.
    }
  });
  const bye = () => { const set = rooms.get(id); if (set) { set.delete(sock); if (!set.size) rooms.delete(id); } };
  sock.on("close", bye); sock.on("error", () => { bye(); try { sock.destroy(); } catch {} });
}

/* ----- HTTP routing ------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }
  try {
    if (p === "/tts" && req.method === "GET") return await handleTTS(req, res, url.searchParams);
    if (p === "/health") {
      let cached = 0; try { cached = fs.readdirSync(path.join(DATA, "tts")).length; } catch {}
      return J(res, { ok: true, keys: { openai: !!OPENAI_KEY, elevenlabs: !!ELEVEN_KEY }, cachedClips: cached });
    }
    if (p === "/sync/new" && req.method === "POST") {
      const id = newId();
      writeSync(id, { json: null, ts: 0 });
      return J(res, { id, code: mintCode(id) });
    }
    if (p === "/sync/code" && req.method === "POST") {
      const b = await readBody(req); const id = String((b && b.id) || "");
      if (!ID_RE.test(id)) return J(res, { error: "bad_id" }, 400);
      if (!readSync(id)) return J(res, { error: "unknown" }, 404);
      return J(res, { code: mintCode(id) });
    }
    if (p === "/sync/pair" && req.method === "POST") {
      const b = await readBody(req); const code = String((b && b.code) || "").replace(/\D/g, "");
      if (code.length !== 6) return J(res, { error: "bad_code" }, 400);
      const id = redeemCode(code);
      if (!id) return J(res, { error: "expired" }, 404);
      const data = readSync(id);
      if (!data) return J(res, { error: "missing" }, 404);
      return J(res, { id, json: data.json, ts: data.ts });
    }
    if (p === "/sync/get" && req.method === "GET") {
      const id = url.searchParams.get("id") || "";
      if (!ID_RE.test(id)) return J(res, { error: "bad_id" }, 400);
      const data = readSync(id);
      if (!data) return J(res, { error: "unknown" }, 404);
      return J(res, data);
    }
    if (p === "/sync/put" && req.method === "PUT") {
      const b = await readBody(req);
      if (!b) return J(res, { error: "too_big" }, 413);
      const id = String(b.id || ""); const ts = Number(b.ts) || Date.now();
      if (!ID_RE.test(id)) return J(res, { error: "bad_id" }, 400);
      if (!b.json || typeof b.json !== "object") return J(res, { error: "bad_json" }, 400);
      if (JSON.stringify(b.json).length > 50000) return J(res, { error: "too_big" }, 413);
      const prev = readSync(id);
      if (!prev) return J(res, { error: "unknown" }, 404);
      if (prev.ts && ts < prev.ts - 1) return J(res, { error: "stale", ts: prev.ts }, 409);
      // Grow-merge instead of blind overwrite: an old offline device can
      // never erase newer progress with a slightly-newer clock.
      const merged = mergeState(prev.json, b.json, prev.ts, ts);
      writeSync(id, { json: merged, ts });
      roomBroadcast(id, JSON.stringify({ type: "snapshot", state: merged, ts }));
      return J(res, { ts });
    }
    if (p === "/sync/delete" && req.method === "POST") {
      const b = await readBody(req); const id = String((b && b.id) || "");
      if (!ID_RE.test(id)) return J(res, { error: "bad_id" }, 400);
      try { fs.unlinkSync(syncPath(id)); } catch {}
      return J(res, { ok: true });
    }
    // Entitlements: everything is free until Creem is wired to the VPS —
    // answer honestly so the client cache stays consistent. (The v133 app
    // short-circuits isPremium() to true anyway.)
    if (p === "/entitlement" && req.method === "GET") {
      return J(res, { premium: false, until: 0, plan: "" });
    }
    if (p === "/") return J(res, { ok: true, service: "frankys-api" });
    return J(res, { error: "not_found" }, 404);
  } catch (e) {
    return J(res, { error: "server_error" }, 500);
  }
});
server.on("upgrade", (req, sock) => { try { handleUpgrade(req, sock); } catch { try { sock.destroy(); } catch {} } });
server.listen(PORT, "127.0.0.1", () => console.log(`frankys-api on 127.0.0.1:${PORT}, data in ${DATA}`));
