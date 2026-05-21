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
    // Mode: "teach" = letter sounds / words / reading (must be exact and
    // accent-free); "chat" = Buddy's warm everyday speech (praise, etc.).
    const teach = searchParams.get("m") === "teach";
    const LANGS = { nl: "Dutch", en: "English", es: "Spanish" };
    const lang = LANGS[(searchParams.get("l") || "en").slice(0, 2)] || "English";

    if (!env.OPENAI_API_KEY) {
      return new Response("server not configured", { status: 500, headers: CORS });
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
      // CHATTER MODE - Buddy's warm everyday voice. Dutch keeps a light,
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
