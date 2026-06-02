# Franky's World - Paid MVP setup (Paddle Billing)

Payments run through **Paddle Billing** (Merchant of Record - Paddle handles
global VAT/sales tax for you, so no Stripe Tax/VAT/OSS setup needed).

The code is **built and deployed**:
- App: paywall + premium gating + entitlement (tied to the sync account),
  **client-side Paddle.js overlay checkout** (lazy-loaded), data-erasure.
- Worker (live): `/billing/webhook` (Paddle-signed), `/billing/portal` (Paddle
  customer portal), `/entitlement`, `/sync/delete`. Fails closed to free until keys set.
- Legal: `privacy.html`, `terms.html`; marketing: `landing.html` (fill the `[PLACEHOLDERS]`).

Paddle's checkout is a client-side overlay, so there are **two config locations**:
publishable values in the app, secret values in the Worker.

---

## 1. In the Paddle dashboard (you) - use **Sandbox** first
Create a sandbox account at sandbox-vendors.paddle.com (separate from live).
1. **Catalog → Products** → create products, then add **Prices**:
   - *Premium - Yearly*: recurring, €69 / year (optionally a 7-day trial).
   - *Premium - Monthly*: recurring, €8.99 / month.
   - *Premium - Lifetime*: **one-time** price, €149.
   Copy each **Price id** (`pri_...`).
2. **Developer Tools → Authentication**:
   - **Client-side token** (`test_...`) - publishable, goes in the app.
   - **API key** (`apikey_...` / secret) - goes in the Worker (for the portal).
3. **Developer Tools → Notifications** → create a destination:
   - URL: `https://api.skep.co/billing/webhook`
   - Events: `transaction.completed`, `subscription.created`, `subscription.updated`,
     `subscription.activated`, `subscription.canceled`, `subscription.past_due`,
     `subscription.paused`, `subscription.trialing`
   - Copy the **secret key** (`pdl_ntfset_...` / signing secret).
4. **Checkout → set the approved domain** to your app domain
   (`frankysworld.skep.co`) so the overlay is allowed there.

## 2. App config (publishable - I can paste these in `index.html` for you)
Near the top of the billing block in `index.html`:
```js
const PADDLE_ENV = "sandbox";                 // "production" at go-live
const PADDLE_CLIENT_TOKEN = "test_xxxxxxxx";  // client-side token
const PADDLE_PRICE = { annual: "pri_...", monthly: "pri_...", lifetime: "pri_..." };
```
Give me the client token + 3 price ids and I'll fill these and push.

## 3. Worker secrets (I can run this with your API key + webhook secret)
```bash
cd tts-worker
npx wrangler secret put PADDLE_API_KEY        # apikey_... (for the customer portal)
npx wrangler secret put PADDLE_WEBHOOK_SECRET # pdl_ntfset_... signing secret
# and set the env (sandbox now, production later):
#   add  [vars]  PADDLE_ENV = "sandbox"  to wrangler.toml, or:
npx wrangler deploy
```
> `PADDLE_ENV` for the Worker controls which Paddle API base the portal uses.
> I've left it defaulting to production; for sandbox testing add `PADDLE_ENV="sandbox"`
> under `[vars]` in `wrangler.toml` (I can do this).

## 4. Test (sandbox)
1. Open the app → hit a locked feature (2nd profile, or reading past the 3rd sound) → paywall.
2. Pick a plan → parent gate → the **Paddle overlay** opens. Pay with a Paddle
   sandbox test card (e.g. `4242 4242 4242 4242`, any future date/CVC).
3. The overlay's `checkout.completed` + the `?billing=success` return both poll
   `/entitlement`; Premium unlocks.
4. Settings → Premium → **Manage subscription** opens the Paddle customer portal.

## 5. Go live
- Recreate products/prices + token/secret in your **live** Paddle account
  (sandbox and live are separate). Update `PADDLE_CLIENT_TOKEN`, `PADDLE_PRICE`,
  `PADDLE_ENV="production"` in `index.html`, and the Worker secrets + remove the
  sandbox `PADDLE_ENV` var.
- Complete Paddle's **website/seller verification** (they review before live payouts).
- Confirm the app's displayed prices match (`pwAnnualP` / `pwMonthlyP` / `pwLifetimeP`).

## 6. Legal (before charging real money)
- Fill every `[PLACEHOLDER]` in `privacy.html`, `terms.html`, `landing.html`.
- Have a kids-privacy lawyer review. Already in code: no ads/trackers, voice
  transcripts never leave the device, parent gate on purchases, working
  "Delete all my data" (local + cloud).

---

## How it works (reference)
- **Checkout is client-side** (Paddle.js overlay), lazy-loaded only when a parent
  taps a plan. It passes `custom_data.sync_id` (+ plan).
- **Entitlement = one record per sync account** (`syncId`) in the sync KV (`ent:<id>`),
  set by the signed Paddle webhook, read by the app via `/entitlement?id=`. The app
  caches it and **fails open to free** - a paying child is never locked out offline;
  an expired sub lapses via the cached `until`.
- **Lifetime** is granted on `transaction.completed` (custom_data.plan==="lifetime");
  **subscriptions** are driven by the `subscription.*` events.
- **Free tier:** first 3 reading sounds (`FREE_SOUNDS`), free-draw, 1 child profile.
- **No separate login:** purchases attach to the cross-device sync account.

## Not needed for the MVP (defer)
Pre-generated audio corpus → R2, App Store/Capacitor wrap, Cloudflare Pages migration,
first-party analytics. See `COMMERCIALIZATION.md`.

> Cleanup: the abandoned Lemon Squeezy API key you pasted earlier should be
> **revoked** in Lemon Squeezy (Settings → API), and the store can be removed.
