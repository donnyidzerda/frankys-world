# Franky's World - project summary (handoff for a new chat)

## What it is
A calm, ad-free educational **PWA** for young children (toddlers/preschool) to learn
**reading, numbers, writing, drawing** with a mascot (Franky, a grey French bulldog).
Dutch-first, also English + Spanish. Single-file vanilla JS app, offline-capable.

## Stack & infra
- **App:** one big file `index.html` (~5000 lines, vanilla JS, no framework). PWA via `manifest.webmanifest` + `sw.js`.
- **Hosting:** GitHub Pages, repo `github.com/donnyidzerda/frankys-world` (branch `main`, deploy from root). Pushing to `main` auto-deploys (~30-60s).
- **Custom domain:** `https://frankysworld.skep.co` (live, valid HTTPS). DNS is on **Cloudflare** (NOT one.com - that was a red herring). CNAME `frankysworld` → `donnyidzerda.github.io`, DNS-only. Cloudflare account id `c59458255c9bea66023a271b9c541874`, zone `skep.co` id `840c2f87cfb5412313b281623ba8f0f0`.
- **Backend:** Cloudflare Worker `scribble-tts` at `https://scribble-tts.donny-idzerda.workers.dev` (code in `tts-worker/worker.js`, `wrangler.toml`). Bindings: KV `SYNC`, Durable Object `PROFILE`. `wrangler` is logged in (account donny.idzerda@gmail.com). Deploy: `cd tts-worker && npx wrangler deploy`.
- Worker does: **TTS** (`/tts`, ElevenLabs per-language voices + OpenAI fallback), **cross-device sync** (`/sync/*`, KV + DO, pair-codes), **billing** (`/billing/*`, `/entitlement`).

## Voice/TTS
- Per-language ElevenLabs voices (nl=Roos, es=Adriana, en=Sarah), `eleven_multilingual_v2`, OpenAI fallback. `TTS_REV=23` (bump to bust audio cache). Audio cached per-phrase in browser Cache Storage + Cloudflare edge.
- Numbers spoken as **words** (`numWord`) not digits, so the multilingual voice picks the right language.
- Device-voice fallback prefers nl-NL (never Belgian nl-BE). Pre-tap speech is held and spoken after first tap (no robot-voice on cold open).

## Monetization (Paddle Billing - Merchant of Record, handles VAT)
- **Model:** per-family. One premium boolean per **sync account** (`syncId`), stored in KV `ent:<syncId>`, set by Paddle webhook, read by app via `/entitlement?id=`. App caches in `S.ent`, **fails open to free** (paid child never locked out offline; expired sub lapses via `until`).
- **Checkout:** client-side **Paddle.js overlay** (lazy-loaded), passes `custom_data.sync_id + plan`. Parent-gated. After pay → `?billing=success` + `checkout.completed` event → poll `/entitlement` → unlock.
- **Prices:** €89/yr (7-day trial) · €11.99/mo · €199 lifetime.
- **Env switch:** `PADDLE_ENV` in BOTH `index.html` (`PADDLE_CFG` holds sandbox+production token+price ids) and `tts-worker/wrangler.toml` `[vars]`. Worker uses `PADDLE_*_SANDBOX` vs `PADDLE_*` secrets accordingly. **Currently set to `sandbox`.**
- **Secrets on worker:** `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` (production), `PADDLE_API_KEY_SANDBOX`, `PADDLE_WEBHOOK_SECRET_SANDBOX` (sandbox). Set via `wrangler secret put`.
- **Paddle account:** production product + 3 prices + webhook created; sandbox product + 3 prices + webhook created. Live client token `live_b176…`, sandbox `test_f04…` (publishable, in app). Webhook → `…workers.dev/billing/webhook`.

## Free vs premium gating (in index.html)
- `FREE_SOUNDS=5` (reading), `FREE_CREATIONS=5` (guided drawings/writing/numbers via DrawScreen), `FREE_MATH=3` (number range). Free-draw + 1 child profile free. Past limits → paywall. Multiple profiles, full curriculum, sync = premium.

## Legal (all in repo, served at domain root)
- `privacy.html`/`terms.html`/`refund.html` (NL) + `-en`/`-es` versions = 9 pages. Filled: **Donny Idzerda, Amperestraat 11 Kudelstaart, KvK 72255269, info@skep.co**, Paddle as MoR.
- In-app links language-aware (`legalUrl()`); consent-to-terms on splash; "Delete all my data" (local+cloud, GDPR) in Settings; voice transcripts never synced.
- `PROCESSORS.md` = GDPR art.30 register + DPA checklist. `COMMERCIALIZATION.md` = full €1M ARR plan.

## State storage
- localStorage keys: `scribble-heroes-idx` (profile index), `scribble-heroes-v2::<id>` (per profile). Version-independent (updates don't wipe progress). Per-origin (domain change = fresh storage; migrate via sync code).

## Verified working
- Full app flow visitor→onboard→home→paywall→parent gate→Paddle.js loads.
- Webhook→entitlement→unlock chain proven with signed synthetic webhooks (grant on subscribe, revoke on cancel, bad-sig→400).
- Voice, sync, legal pages, gating all tested in preview (server "scribble" on :4173) + live.

## Outstanding (the only things left)
1. **Paddle production approval** (their dashboard + Paddle review): seller verification, domain `frankysworld.skep.co` Approved, default payment link set. **This is the critical path to a real sale** - Paddle dashboards are blocked for the assistant's browser tool, so the user must do it.
2. **Flip `PADDLE_ENV` → production** in `index.html` + `wrangler.toml` (then `wrangler deploy`) once Paddle is approved. One-line change; production token/prices/webhook already wired.
3. **Rotate keys** that appeared in chat before public launch: OpenAI + ElevenLabs (worker secrets), revoke the unused Lemon Squeezy key.
4. **Lawyer review** of policies before scaling (not strictly before sale #1).

## Gotchas for the assistant
- Browser tool **blocks payment dashboards** (vendors.paddle.com, lemonsqueezy.com) and was flaky on dash.cloudflare.com (cookie modal / SES). Use provider **APIs** with keys the user pastes; delete temp key files after; never echo secrets.
- This machine had **stale negative DNS cache** for the new domain - use `--resolve ...:443:185.199.108.153` or public resolvers to test; the user's devices may need a DNS flush / mobile data.
- MetaMask extension logs SES noise in the page console (ignore).
- Preview tool: server name `scribble` on port 4173 (`preview_start`), serves the repo statically. Reload after edits; check `preview_console_logs` for errors.
- Commit style: end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Push to `main` deploys.

## Recent version log
v95 Rekenen in spoken greeting · v96 fix overlapping voices · v97 numbers in-language ·
v98 cache-bust · v99 fix Belgian device voice + held greeting · v100/101 paid MVP (Stripe) ·
v103 switch to Lemon Squeezy · v104 switch to Paddle · v105-108 Paddle wiring + sandbox ·
v109 prices €89/€11.99/€199 · v110 free-taste gating · v111 legal hygiene · v112 EN/ES legal + go-live docs.
See `GO-LIVE.md` for the launch checklist.
