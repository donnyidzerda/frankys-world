# Franky's World — Paid MVP setup (your remaining steps)

The code for a paid web app is **built and deployed**:
- App: paywall + premium gating + entitlement (tied to the sync account), data-erasure button.
- Worker: `/billing/checkout`, `/billing/portal`, `/billing/webhook`, `/entitlement`, `/sync/delete` — live, gracefully returning `503`/free until Stripe keys are set.
- Legal: `privacy.html`, `terms.html`; marketing: `landing.html` (fill the `[PLACEHOLDERS]`).

What's left is what **only you** can do: a Stripe account, real keys, legal sign-off, business/VAT. Follow the steps below; nothing here requires touching code.

---

## 1. Stripe account + products (~30 min)
1. Create a Stripe account → add business + bank details → enable **Stripe Tax** (Settings → Tax) for automatic EU VAT.
2. Create 3 prices (Product catalog). Keep currency EUR:
   - **Annual** — recurring, €69/year → copy the **price id** (`price_...`) → this is `STRIPE_PRICE_ANNUAL`.
   - **Monthly** — recurring, €8.99/month → `STRIPE_PRICE_MONTHLY`.
   - **Lifetime** — one-time, €149 → `STRIPE_PRICE_LIFETIME`.
   > The 7-day free trial is set **in code** for subscriptions — do *not* also add a trial on the price (avoids a double trial).
3. Enable the **Customer Portal** (Settings → Billing → Customer portal) so parents can cancel/manage.
4. Grab your **Secret key** (`sk_test_...` while testing, `sk_live_...` later).

## 2. Webhook (so payments flip the entitlement)
1. Stripe → Developers → **Webhooks** → Add endpoint:
   - URL: `https://scribble-tts.donny-idzerda.workers.dev/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
2. Copy the endpoint's **Signing secret** (`whsec_...`) → this is `STRIPE_WEBHOOK_SECRET`.

## 3. Give the Worker the keys (in `tts-worker/`, you're already logged into wrangler)
```bash
cd tts-worker
npx wrangler secret put STRIPE_SECRET_KEY        # paste sk_test_... (then sk_live_... at go-live)
npx wrangler secret put STRIPE_WEBHOOK_SECRET     # paste whsec_...
npx wrangler secret put STRIPE_PRICE_ANNUAL       # paste price_...
npx wrangler secret put STRIPE_PRICE_MONTHLY      # paste price_...
npx wrangler secret put STRIPE_PRICE_LIFETIME     # paste price_...
npx wrangler deploy
```
That's it — the billing endpoints go from `503` to live automatically.

## 4. Test (test mode)
1. Open the app, hit a locked feature (a 2nd child profile, or reading past the 3rd sound) → the paywall appears.
2. Pick a plan → parent gate → Stripe Checkout. Use test card **4242 4242 4242 4242**, any future date/CVC.
3. After paying you return to the app; it polls `/entitlement` and shows the thank-you. Premium unlocks.
4. Settings → Premium → **Manage subscription** opens the Stripe portal. Cancelling there flips you back to free on the next refresh.
5. Cross-device: link another device with the sync code — premium follows the account.

## 5. Go live
- Swap the test keys/prices for **live** ones (`wrangler secret put ...` again) and add a **live** webhook endpoint → update `STRIPE_WEBHOOK_SECRET`.
- Confirm the prices shown in the app match Stripe. App price labels live in `index.html` (`pwAnnualP`, `pwMonthlyP`, `pwLifetimeP`, per language).

## 6. Legal (do before charging real money)
- Fill every `[PLACEHOLDER]` in `privacy.html`, `terms.html`, `landing.html`: `[BEDRIJFSNAAM]`, `[ADRES]`, `[KVK-NUMMER]`, `[CONTACT-EMAIL]`, `[DATUM]`, `[JAAR]`.
- These are solid drafts — have a **kids-privacy lawyer** review them before scaling (GDPR/GDPR-K, COPPA if you sell in the US).
- Already handled in code: no ads/trackers, voice transcripts never leave the device, parent gate on purchases, and a working **"Delete all my data"** button (local + cloud erasure).

## 7. Business / tax
- Start as **eenmanszaak** (fast) or set up a **BV**; register for VAT and use **Stripe Tax**/OSS for EU digital sales.

---

## How it works (reference)
- **Entitlement = one record per sync account** (`syncId`), stored in the same Cloudflare KV as sync (`ent:<id>`), set by the Stripe webhook, read by the app via `/entitlement?id=`. The app caches it (`S.ent`) and **fails open to free** — a paying child is never locked out offline; an expired sub lapses via the cached `until` timestamp.
- **Free tier:** first 3 reading sounds (`FREE_SOUNDS` in `index.html`), free-draw, 1 child profile. Everything else shows the paywall.
- **No separate login:** purchases attach to the existing cross-device sync account, so the sync code is also the "restore purchase" path. (Email magic-link auth is a later upgrade if you want web login without a device handoff.)

## Not needed for the MVP (defer)
Pre-generated audio corpus → R2 (margin at scale), App Store/Capacitor wrap, Cloudflare Pages migration, first-party analytics. See `COMMERCIALIZATION.md` for the full roadmap.
