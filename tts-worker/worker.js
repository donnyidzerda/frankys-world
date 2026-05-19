/* =========================================================================
   Scribble Heroes - TTS proxy (Cloudflare Worker)

   Holds the OpenAI API key as an encrypted secret (NEVER in the app or
   the repo) and turns short text into a warm, gentle child-friendly MP3
   using OpenAI's gpt-4o-mini-tts. The browser caches each phrase, so a
   given line is generated once and then replays free and offline.

   Deploy: see README.md in this folder.
   ========================================================================= */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const { pathname, searchParams } = new URL(req.url);
    if (pathname !== "/tts") return new Response("ok", { headers: CORS });

    // Keep requests tiny and abuse-resistant: short text only.
    const text = (searchParams.get("t") || "").slice(0, 300).trim();
    if (!text) return new Response("missing text", { status: 400, headers: CORS });
    const slow = searchParams.get("s") === "1";
    const LANGS = { nl: "Dutch", en: "English", es: "Spanish" };
    const lang = LANGS[(searchParams.get("l") || "en").slice(0, 2)] || "English";

    if (!env.OPENAI_API_KEY) {
      return new Response("server not configured", { status: 500, headers: CORS });
    }

    const instructions =
      `Language: speak in ${lang} with a natural native ${lang} accent. ` +
      "Voice: a warm, kind, calm preschool teacher speaking to a small " +
      "child aged one to five. Tone: gentle, encouraging, unhurried, and " +
      "loving. " + (slow
        ? "Pace: very slow and clear, with soft pauses between phrases."
        : "Pace: slow and clear, never rushed.");

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
