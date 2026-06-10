# Franky's World — self-hosted API (VPS)

Replaces the Cloudflare Worker + Supabase for the v2 deployment. Pure Node
(stdlib only, no npm install). nginx proxies `https://<host>/api/` →
`127.0.0.1:8787/`, including the `/sync/ws` WebSocket upgrade.

## What it does

- **TTS with a generate-once disk cache** — every unique phrase is
  synthesized at most once per voice revision (`/var/lib/frankys/tts/`),
  then served from disk to every visitor forever. ElevenLabs speaks chat
  lines, OpenAI `gpt-4o-mini-tts` speaks teaching lines (phonics rules).
  Without API keys it returns 503 and the app falls back to the device voice.
- **Pair-code sync** — `/sync/new|code|pair|get|put|delete` plus a real-time
  WebSocket room (`/sync/ws?id=`) with the same grow-only merge as the app.
  State lives in `/var/lib/frankys/sync/`, GDPR delete removes the file.

## Install (once, as root)

```sh
install -d -o deploy -g deploy /var/lib/frankys
install -m 600 -o deploy /dev/null /etc/frankys-api.env
cp vps-api/frankys-api.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now frankys-api
```

## Secrets (owner only — paste your own keys)

```sh
sudo nano /etc/frankys-api.env       # add the two lines:
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
sudo systemctl restart frankys-api
```

## Deploy an update

`./deploy.sh` (git pull) then `sudo systemctl restart frankys-api` if
`vps-api/` changed. Health: `curl -s localhost:8787/health`.
