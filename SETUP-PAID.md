# Franky's World — Paid MVP setup (Lemon Squeezy)

Payments run through **Lemon Squeezy** (Merchant of Record — it handles global
VAT/sales tax for you, so no Stripe Tax/VAT/OSS setup needed).

The code is **built and deployed**:
- App: paywall + premium gating + entitlement (tied to the sync account), data-erasure.
- Worker (live): `/billing/checkout`, `/billing/portal`, `/billing/webhook`, `/entitlement`,
  `/sync/delete`. All fail closed to free / `503` until the Lemon Squeezy keys are set.
- Legal: `privacy.html`, `terms.html`; marketing: `landing.html` (fill the `[PLACEHOLDERS]`).

What's left needs your Lemon Squeezy account. The dashboard can't be automated
here, so **you create the products + an API key** (5 min); then I can wire up the
rest via the LS API (store id, variant ids, webhook), set the worker secrets and
test — just paste me the API key.

---

## 1. In the Lemon Squeezy dashboard (you)
1. Create/confirm your **Store**. Turn on **Test mode** (top bar) while we test.
2. Create products/variants (Products → New):
   - **Premium — Yearly**: Subscription, €69 / year. (Optionally add a 7-day free trial.)
   - **Premium — Monthly**: Subscription, €8.99 / month.
   - **Premium — Lifetime**: Single payment, €149.
   Name them clearly so the variants are easy to tell apart.
3. **Settings → API → Create API key** → copy it (starts with `eyJ...`). 

That's all you need to do by hand. Paste me the API key and I'll do steps 2–4 below.

## 2. Get the IDs (I can run this with your API key)
```bash
LS=eyJ...   # your API key
curl -s https://api.lemonsqueezy.com/v1/stores  -H "Authorization: Bearer $LS" -H "Accept: application/vnd.api+json" | python3 -m json.tool | grep -E '"id"|"name"'
curl -s "https://api.lemonsqueezy.com/v1/variants?page[size]=100" -H "Authorization: Bearer $LS" -H "Accept: application/vnd.api+json" | python3 -m json.tool | grep -E '"id"|"name"|"price"'
```
→ note the **store id** and the three **variant ids** (annual / monthly / lifetime).

## 3. Create the webhook (I can run this)
```bash
curl -s -X POST https://api.lemonsqueezy.com/v1/webhooks \
  -H "Authorization: Bearer $LS" -H "Accept: application/vnd.api+json" -H "Content-Type: application/vnd.api+json" \
  -d '{"data":{"type":"webhooks","attributes":{
        "url":"https://scribble-tts.donny-idzerda.workers.dev/billing/webhook",
        "events":["subscription_created","subscription_updated","subscription_cancelled","subscription_resumed","subscription_expired","subscription_paused","order_created"],
        "secret":"PICK_A_LONG_RANDOM_STRING"},
      "relationships":{"store":{"data":{"type":"stores","id":"STORE_ID"}}}}}'
```
The `secret` is one you choose — it becomes `LS_WEBHOOK_SECRET`.

## 4. Set the Worker secrets + deploy (I can run this)
```bash
cd tts-worker
npx wrangler secret put LS_API_KEY          # the eyJ... key
npx wrangler secret put LS_STORE_ID         # store id
npx wrangler secret put LS_WEBHOOK_SECRET   # the random string from step 3
npx wrangler secret put LS_VARIANT_ANNUAL   # variant id
npx wrangler secret put LS_VARIANT_MONTHLY  # variant id
npx wrangler secret put LS_VARIANT_LIFETIME # variant id
npx wrangler deploy
```
Billing flips from `503` to live automatically.

## 5. Test (test mode)
1. Open the app → hit a locked feature (2nd profile, or reading past the 3rd sound) → paywall.
2. Pick a plan → parent gate → Lemon Squeezy checkout. Use a **test card** (`4242 4242 4242 4242`).
3. You return to the app; it polls `/entitlement` and unlocks Premium.
4. Settings → Premium → **Manage subscription** opens the LS customer portal.

## 6. Go live
- Turn **off** Test mode in LS, complete store **activation** (identity/payout — LS pays you out).
- The same API key works; live transactions just need the store activated.
- Confirm the app's displayed prices match (in `index.html`: `pwAnnualP` / `pwMonthlyP` / `pwLifetimeP`, per language).

## 7. Legal (before charging real money)
- Fill every `[PLACEHOLDER]` in `privacy.html`, `terms.html`, `landing.html`.
- Have a kids-privacy lawyer review. Already in code: no ads/trackers, voice transcripts never leave the device, parent gate on purchases, working "Delete all my data" (local + cloud).

---

## How it works (reference)
- **Entitlement = one record per sync account** (`syncId`), in the sync KV (`ent:<id>`), set by
  the LS webhook (which receives `custom_data.sync_id` from checkout) and read by the app via
  `/entitlement?id=`. The app caches it and **fails open to free** — a paying child is never
  locked out offline; an expired sub lapses via the cached `until`.
- **Free tier:** first 3 reading sounds (`FREE_SOUNDS`), free-draw, 1 child profile.
- **No separate login:** purchases attach to the cross-device sync account, so the sync code is
  also the "restore purchase" path.

## Not needed for the MVP (defer)
Pre-generated audio corpus → R2, App Store/Capacitor wrap, Cloudflare Pages migration,
first-party analytics. See `COMMERCIALIZATION.md`.
