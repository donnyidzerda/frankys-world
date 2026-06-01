# GO-LIVE — first sale checklist

Stack now: **Supabase** (accounts + data + entitlements, EU/Ireland) · **Creem**
(Merchant of Record, VAT) · **Cloudflare Worker** (TTS + billing proxy) ·
**GitHub Pages** (static hosting).

The engineering is built and verified. What's left is a short list of
account-gated steps (yours) + a paired deploy.

> ⚠️ **Deploy the worker and the app TOGETHER.** The new worker drops the old
> `/entitlement` route (the app now reads Supabase directly). Deploying either
> alone breaks billing. Nothing is deployed yet — the live site still runs the
> old (Paddle/pair-code) version.

## A. YOU — three Worker secrets (I can't store keys; safety rule)
In `tts-worker/`:
```
npx wrangler secret put SUPABASE_SERVICE_KEY      # Supabase → Settings → API Keys → secret key
npx wrangler secret put CREEM_API_KEY_TEST        # Creem → Developers → API key (Test)
npx wrangler secret put CREEM_WEBHOOK_SECRET_TEST # from the webhook in step B
```

## B. YOU — Creem webhook (no API for this; ~2 min in dashboard)
Creem → Developers → Webhooks → Add endpoint:
- URL: `https://scribble-tts.donny-idzerda.workers.dev/billing/webhook`
- Events: `checkout.completed, subscription.active, subscription.paid, subscription.canceled, subscription.expired, subscription.past_due, refund.created, dispute.created`
- Copy the signing secret → that's `CREEM_WEBHOOK_SECRET_TEST` in step A.

## C. Optional now
- 7-day trial on the Annual product (Creem dashboard — the product API has no trial field).
- **Google / Apple SSO:** create OAuth clients (Google Cloud / Apple Developer), add them in Supabase → Authentication → Providers (redirect `https://paynhwqxosinwkzzuytz.supabase.co/auth/v1/callback`), then flip `SSO.google` / `SSO.apple` to `true` in `index.html`. Email/password recovery works without this.

## D. Then I verify + we deploy (test mode)
- I verify Creem **test** checkout → webhook → Supabase entitlement → premium unlock (needs A+B done). Checkout *creation* is already proven via the Creem API; the worker webhook→entitlement path is reviewed and ready.
- Deploy: `wrangler deploy` (worker) **and** `git push` (app) in the same window.

## E. Go-live hardening (before public / real money)
- **Creem → Live mode:** recreate the 3 products live, set `CREEM_API_KEY` + `CREEM_WEBHOOK_SECRET` (live) as secrets, set `CREEM_PRODUCTS` (live ids) + `CREEM_ENV="live"` in `wrangler.toml`.
- **Supabase:** turn **off** `mailer_autoconfirm` and configure **custom SMTP** (so account/confirmation emails deliver); review RLS once more.
- **Rotate keys** that touched chat: OpenAI, ElevenLabs, the Creem **test** key; revoke the unused Lemon Squeezy key.
- **Wipe test data:** clear any dev rows in Supabase (`profiles`/`entitlements`/`auth.users`) before launch.
- Confirm **Creem accepts the young-children educational category** and put Creem's exact **legal entity name** into the legal docs.
- **Lawyer review** of privacy/terms/refund (NL+EN+ES) before scaling.

## What's DONE (verified)
- Supabase: schema + RLS + anonymous/email auth + EU region — live.
- Creem: 3 products (€89/yr +trial-todo · €11,99/mo · €199 lifetime), test mode — live.
- App: anonymous play (no signup wall) → secure with email/SSO (uid preserved) → recover by login on a fresh device → grow-only multi-device sync → entitlement read → Creem checkout redirect. Verified end-to-end against the live Supabase project.
- Worker: provider-agnostic billing (Creem default, Paddle fallback), entitlement → Supabase, refund/dispute revoke, rate-limited TTS.
- Legal: privacy/terms/refund (NL+EN+ES) + PROCESSORS.md updated for Supabase + Creem + account/email + EU storage.

## Privacy posture note (decision worth a glance)
Cloud sync is now **on by default** under an **anonymous** account (first name +
progress sync to Supabase/EU from first use) so data survives device loss. Email
is optional (recovery only). This is disclosed in the privacy pages. If you'd
rather make cloud sync opt-in, say so — it's a small change to gate `SupaSync`.
