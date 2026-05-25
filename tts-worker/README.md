# Franky's World - realistic voice proxy

A tiny Cloudflare Worker that turns text into a warm, child-friendly voice
with OpenAI `gpt-4o-mini-tts`. It exists so the OpenAI API key is **never**
exposed in the static app. Free tier is plenty (100k requests/day); the app
caches every phrase so each line is generated only once.

## One-time setup (about 5 minutes)

You need: a free Cloudflare account, and an OpenAI API key
(https://platform.openai.com/api-keys - add a small amount of credit, this
costs cents).

From this folder:

```bash
cd "tts-worker"

# 1. Log in to Cloudflare (opens a browser once; free account is fine)
npx wrangler login

# 2. Store your OpenAI key as an ENCRYPTED secret (never written to disk/repo)
npx wrangler secret put OPENAI_API_KEY
#    → paste your sk-... key when prompted, press Enter

# 3. Deploy
npx wrangler deploy
```

`wrangler deploy` prints a URL like:

```
https://scribble-tts.<your-subdomain>.workers.dev
```

## Final step

Send that URL back, and it gets wired into the app (one constant), then the
app is redeployed. After that, online play uses the realistic voice; offline
or if the proxy is unreachable, it automatically falls back to the device
voice. Nothing breaks either way.

To test immediately without redeploying, open the live app and run in the
browser console:

```js
localStorage.setItem("tts_url", "https://scribble-tts.<your-subdomain>.workers.dev");
location.reload();
```

## Cost & safety

- Key lives only as a Cloudflare encrypted secret - not in the app, not in git.
- Requests are capped at 300 characters and limited to the `/tts` path.
- Browser caches audio per phrase, so repeats are free and work offline.
- `gpt-4o-mini-tts` is inexpensive (fractions of a cent per phrase); with
  caching, real-world usage is a few cents total.
