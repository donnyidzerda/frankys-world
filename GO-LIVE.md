# GO-LIVE — first sale checklist

Everything technical is built. The **critical path to a real sale** is Paddle
approving your production account/domain — that's the only thing that can block
"tomorrow", and it's on Paddle's side.

## A. Paddle production (YOU — do first, may need Paddle review time)
- ☐ Complete **seller verification** in your live Paddle account (business details, payout/bank). Paddle reviews new sellers — this can take hours to a few days, so start now.
- ☐ **Checkout settings → Default payment link** = `https://frankysworld.skep.co/`.
- ☐ **Checkout settings → Domains** → `frankysworld.skep.co` status = **Approved** (not pending).
- ☐ Confirm a payment method is enabled (cards) for the account.

Already done for production (by me, via API): product + 3 prices (€89/€11.99/€199) + webhook; worker secrets `PADDLE_API_KEY` / `PADDLE_WEBHOOK_SECRET` set; live client token + price ids in the app config.

## B. Flip the app to production (ONE change — I can do it on your word)
Currently `PADDLE_ENV` = **sandbox** (for testing). To go live:
1. `index.html`: `const PADDLE_ENV = "production";`
2. `tts-worker/wrangler.toml`: set `[vars] PADDLE_ENV = "production"` (or remove the var) → `wrangler deploy`.

That's it — production token/prices/webhook are already wired behind the switch.

## C. Smoke test the real flow (YOU, ~2 min, refundable)
1. Open `https://frankysworld.skep.co/`, reach the paywall, pick **Monthly €11.99**.
2. Parent gate → Paddle overlay → pay with your **real card**.
3. Confirm Premium unlocks (app polls entitlement).
4. Settings → Premium → **Manage subscription** → cancel; refund via Paddle dashboard if you want the €11.99 back.
   (Server chain webhook→entitlement→unlock is already proven with signed test webhooks.)

## D. Security before public launch
- ☐ Rotate API keys that ever appeared in chat: **OpenAI**, **ElevenLabs** (worker `wrangler secret put`), and the **Lemon Squeezy** key (revoke in LS, unused).
- ☐ The Paddle keys you pasted are fine (stored as worker secrets); rotate later if you want.

## E. Distribution (to actually get the first sale)
- ☐ Share the **landing page**: `https://frankysworld.skep.co/landing.html` (or make it the root later).
- ☐ Post your founder story / to parent communities; DM friends with kids.
- ☐ "Add to Home Screen" works (PWA) — tell users.

## Status of everything else (DONE)
- App: paywall, per-family entitlement (unlimited kids+devices), free-taste gating (5 sounds / 5 creations / math start), premium unlock, manage subscription, "delete all my data".
- Legal: privacy / terms / refund in **NL + EN + ES**, language-aware links, consent-on-splash, processor register (`PROCESSORS.md`).
- Billing: Paddle (MoR, handles VAT). Sandbox + production both wired; switch via `PADDLE_ENV`.
- Worker: signed webhook → entitlement (proven), customer portal, GDPR delete.

## Honest blockers (can't be me)
1. **Paddle seller/domain approval** (section A) — gates real checkout. Start ASAP.
2. **Lawyer review** of the policies before scaling (not strictly before the very first sale, but soon).
