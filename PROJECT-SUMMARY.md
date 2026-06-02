# Franky's World - project summary (handoff for a new chat)

## What it is
A calm, ad-free educational **PWA** for young children (toddlers/preschool) to learn
**reading, numbers, writing, drawing** with a mascot (Franky, a grey French bulldog).
Dutch-first, also English + Spanish. Single-file vanilla JS app, offline-capable.

## Stack & infra
- **App:** one big file `index.html` (~5900 lines, vanilla JS, no framework). PWA via `manifest.webmanifest` + `sw.js`.
- **Hosting:** GitHub Pages, repo `github.com/donnyidzerda/frankys-world` (branch `main`, deploy from root). Pushing to `main` auto-deploys (~30-60s).
- **Custom domain:** `https://frankysworld.skep.co` (live, valid HTTPS). DNS is on **Cloudflare** (NOT one.com - that was a red herring). CNAME `frankysworld` -> `donnyidzerda.github.io`, DNS-only. Cloudflare account id `c59458255c9bea66023a271b9c541874`, zone `skep.co` id `840c2f87cfb5412313b281623ba8f0f0`.
- **Backend:** Cloudflare Worker `scribble-tts` at `https://scribble-tts.donny-idzerda.workers.dev` (code in `tts-worker/worker.js`, `wrangler.toml`). Bindings: KV `SYNC`, Durable Object `PROFILE` (legacy pair-code sync). `wrangler` is logged in (account donny.idzerda@gmail.com). Deploy: `cd tts-worker && npx wrangler deploy`.
- Worker does: **TTS** (`/tts`, ElevenLabs per-language voices + OpenAI fallback), **legacy sync** (`/sync/*`, KV + DO pair-codes, kept until the Supabase path is fully retired), **billing** (`/billing/*`, provider-agnostic), and **GDPR account deletion** (`/account/delete`).

## Identity + data: Supabase (the durable layer)
- **Why:** localStorage-only loses all progress + premium when the PWA is deleted / cache cleared / iOS 7-day eviction. Supabase gives a recoverable account so data AND entitlement survive a wiped device.
- **Project:** ref `paynhwqxosinwkzzuytz`, region AWS eu-west-1 (Ireland, EU). URL `https://paynhwqxosinwkzzuytz.supabase.co`. Anon/publishable key lives in `index.html` (`SUPABASE_ANON_KEY`); `SUPABASE_URL` also in `wrangler.toml`.
- **Schema** (`supabase/schema.sql`, idempotent): `profiles` (one row per child, `state` jsonb = the grow-only learning blob, matched by `state->>id`), `entitlements` (one row per family/auth user, written ONLY by the billing webhook via service role), `billing_links` (`cust:<id>`/`txn:<id>` -> uid, for refund/renewal lookup). RLS: a family reads/writes only its own rows; entitlements are read-only to clients; billing_links are service-role only. All three FK `auth.users(id) ON DELETE CASCADE`.
- **Auth:** anonymous on first boot; later **linked** to email/password or Google/Apple SSO so the same **uid** (and its data + premium) is preserved. Recovery on a new device = just sign in, then `SupaSync.restoreAll()` pulls the cloud profiles down.
- **App wiring (in `index.html`):** `Account` (anon sign-in, link email, SSO via `linkIdentity`), `SupaSync` (per-profile rows, grow-only merge, realtime), `Ent` reads the entitlement from Supabase by uid. Feature-flagged: `USE_SUPABASE` is true when `SUPABASE_URL` + anon key are set; the legacy pair-code path stays intact when off. `SSO = { google:false, apple:false }` until OAuth providers are configured.

## Voice/TTS
- Per-language ElevenLabs voices (nl=Roos, es=Adriana, en=Sarah), `eleven_multilingual_v2`, OpenAI fallback. `TTS_REV` rides on each TTS request (bump to bust audio cache). Audio cached per-phrase in browser Cache Storage + Cloudflare edge.
- Numbers spoken as **words** (`numWord`) not digits, so the multilingual voice picks the right language.
- Device-voice fallback prefers nl-NL (never Belgian nl-BE). Pre-tap speech is held and spoken after first tap (no robot-voice on cold open).

## Monetization (Creem Billing - Merchant of Record, handles VAT)
- **Provider switch-freedom:** the Worker is provider-agnostic (`BILLING_PROVIDER` = `creem` | `paddle`). **Creem** is live; the Paddle adapter is kept only as a fallback.
- **Model:** per-family. One premium row per Supabase **uid** in `entitlements`, set by the signed Creem webhook, read by the app **directly from Supabase**. App caches in `S.ent`, **fails open to free** (paid child never locked out offline; a lapsed sub expires via `until`).
- **Checkout:** **server-created** Creem hosted checkout. App POSTs `/billing/checkout {uid, plan, return}` -> Worker calls Creem `POST /v1/checkouts` with `metadata:{uid,plan}` -> returns `checkout_url` -> app redirects. Parent-gated (math challenge) before checkout opens. On return `?billing=success` the app polls the Supabase entitlement until the webhook lands.
- **Webhook** (`/billing/webhook`, header `creem-signature` = HMAC-SHA256 hex): `checkout.completed` grants (lifetime -> forever, sub -> period end); `subscription.*` grants/revokes by status; `refund.created`/`dispute.created` revoke a lifetime grant via the stored `cust:` link. Renewal/cancel events that omit metadata fall back to the `cust:` billing-link to find the family.
- **Prices:** EUR 89/yr (7-day trial, set at checkout level) - EUR 11.99/mo - EUR 199 lifetime. Creem TEST product ids are in `wrangler.toml` `CREEM_PRODUCTS_TEST`.
- **Env switch:** `BILLING_PROVIDER` + `CREEM_ENV` (`test`/`live`) in `wrangler.toml`; `BILLING_PROVIDER` mirrored in `index.html`. `CREEM_ENV=test` uses `test-api.creem.io` + the `*_TEST` secrets/products. **Currently `test`.**
- **Secrets on Worker** (set via `wrangler secret put`, never in the repo): `CREEM_API_KEY_TEST`, `CREEM_WEBHOOK_SECRET_TEST` (+ `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` at go-live), `SUPABASE_SERVICE_KEY` (webhook writes entitlements + `/account/delete` admin-deletes users), plus `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`.

## Free vs premium gating (in index.html)
- `FREE_SOUNDS=5` (reading), `FREE_CREATIONS=5` (guided drawings/writing/numbers via DrawScreen), `FREE_MATH=3` (number range). Free-draw + 1 child profile free. Past limits -> paywall. Multiple profiles, full curriculum, cross-device sync = premium.

## Legal (all in repo, served at domain root)
- `privacy.html`/`terms.html`/`refund.html` (NL) + `-en`/`-es` versions = 9 pages. Filled: **Donny Idzerda, Amperestraat 11 Kudelstaart, KvK 72255269, info@skep.co**. Disclose **Creem** as MoR and **Supabase** (EU/Ireland) as the identity+data processor, email/account PII, cloud-sync-on-by-default (anonymous) posture.
- In-app links language-aware (`legalUrl()`); consent-to-terms on splash; "Delete all my data" (local + cloud) in Settings = GDPR right-to-erasure: deletes the Supabase auth user (cascades all rows) via `/account/delete`, with an RLS profile-delete fallback, then signs out and clears local. Voice transcripts never synced.
- `PROCESSORS.md` = GDPR art.30 register + DPA checklist. `COMMERCIALIZATION.md` = full EUR 1M ARR plan. `GO-LIVE.md` = launch checklist for the Creem/Supabase stack.

## State storage
- localStorage keys: `scribble-heroes-idx` (profile index), `scribble-heroes-v2::<id>` (per profile). Version-independent (updates don't wipe progress). Per-origin. Durable identity is the Supabase **uid** (replaces the old `syncId`); cloud profiles in Supabase are the recoverable source of truth.
- Device-local data NEVER synced: gallery PNGs (IndexedDB `scribble-gallery`), `readHeard` voice transcripts (stripped via `SYNC_OMIT` before push).

## Verified working
- Full app flow visitor -> onboard -> home -> activity -> free-limit -> paywall -> parent gate (tested in preview).
- Supabase anonymous sign-in, profile push/pull, grow-only merge, link-email (same uid), recover-by-login, entitlement read, RLS all verified against the live project.
- Creem checkout CREATION verified via API (returns `checkout_url`, metadata echoed). End-to-end checkout->webhook->entitlement->unlock still pending the owner's Worker secrets + dashboard webhook.
- GDPR "Delete all my data": cloud profile erasure + signOut verified live (RLS fallback path).

## Outstanding (the only things left)
1. **Owner Worker secrets** (assistant won't store keys): `CREEM_API_KEY_TEST`, `CREEM_WEBHOOK_SECRET_TEST`, `SUPABASE_SERVICE_KEY` via `wrangler secret put`.
2. **Creem webhook** in the Creem dashboard -> `…workers.dev/billing/webhook` (events: checkout.completed, subscription.active/paid/canceled/expired/past_due, refund.created, dispute.created). Creem has no webhook-management API, so this is a dashboard step.
3. **Deploy Worker + app TOGETHER** (the app reads entitlement from Supabase and calls the new `/billing/checkout` + `/account/delete`; the old `/entitlement` route is gone). Nothing is deployed yet - local `main` is ahead of `origin/main`; live still runs the old Paddle build.
4. **Supabase go-live hardening:** turn OFF `mailer_autoconfirm` + add custom SMTP; wipe test artifacts (stray anonymous users / test profiles); optional Annual 7-day trial; optional Google/Apple OAuth creds (then flip `SSO` flags true).
5. **Rotate keys** that appeared in chat before public launch: OpenAI + ElevenLabs (Worker secrets), Creem test API key; revoke any unused Paddle/Lemon Squeezy keys.
6. **Lawyer review** of policies before scaling (not strictly before sale #1).

## Gotchas for the assistant
- Browser tool historically **blocked payment dashboards**; use provider **APIs** with keys the user pastes, delete temp key files after, never echo secrets.
- This machine had **stale negative DNS cache** for the domain - use public resolvers / `--resolve` to test; the user's devices may need a DNS flush / mobile data.
- MetaMask extension logs SES noise in the page console (ignore).
- Preview tool: server name `scribble` on port 4173 (`preview_start`), serves the repo statically. Reload after edits; check console logs for errors.
- Commit style: end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Push to `main` deploys.
- Keep `sw.js` `CACHE` bumped each release (cache-bust) so returning PWAs get fresh assets.

## Recent version log
v100/101 paid MVP (Stripe) - v103 Lemon Squeezy - v104-109 Paddle wiring + sandbox + prices -
v110 free-taste gating - v111-112 legal hygiene + EN/ES legal + go-live docs -
v113 trial copy - v114 provider-agnostic billing backend (Supabase + Creem) - v114a live Supabase URL + Creem product ids -
v115 app cutover to Supabase accounts + sync (feature-flagged) - v116 legal + SSO wiring + GO-LIVE refresh -
v117 gameplay/UX audit fixes - v118 high-contrast accessibility - v119 em/en-dash copy cleanup -
v120 NL TTS pronunciation + new logo - v121 GDPR cloud-erasure fix + webhook renewal-link fallback + cache-bust.
See `GO-LIVE.md` for the launch checklist.
