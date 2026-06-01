# Supabase + Creem setup runbook

Stand these two services up, then hand back the **3 values** at the bottom. I
build the app cutover + verify end-to-end once they exist. Nothing here touches
the live app until we deploy the new worker **and** app together (the new worker
drops `/entitlement`, so they must ship as a pair).

Secrets you set with `wrangler secret put` are **never** pasted to me — I only
need them *set*, not their values. The only client-safe value I need is the
Supabase **anon** key (it's designed to live in the browser).

---

## 1 · Supabase

### 1.1 Create the project
- supabase.com → New project.
- **Region: EU (Frankfurt / `eu-central-1`)** — GDPR, your users are EU-first.
- Save the database password somewhere safe (not needed by the app).

### 1.2 Apply the schema
- SQL Editor → New query → paste the entire contents of
  [`supabase/schema.sql`](supabase/schema.sql) → **Run**. (Idempotent; safe to
  re-run.) Confirm tables `profiles`, `entitlements`, `billing_links` exist with
  RLS enabled.

### 1.3 Auth providers (Authentication → Providers)
- **Anonymous**: enable. (Authentication → Settings → "Allow anonymous sign-ins"
  ON.) This is what lets a child play instantly with no signup wall.
- **Email**: enable, with "Confirm email" ON. (Password + magic-link both work.)
- **Google**: enable. You'll need a Google Cloud OAuth client (Client ID +
  Secret). Authorized redirect URI:
  `https://<YOUR-REF>.supabase.co/auth/v1/callback`
- **Apple**: enable. Apple Developer → Service ID + Sign-in key. Same callback
  redirect URI as above.

### 1.4 URL configuration (Authentication → URL Configuration)
- **Site URL**: `https://frankysworld.skep.co`
- **Redirect URLs** (add both): `https://frankysworld.skep.co/**` and
  `http://localhost:4173/**` (so I can verify on the preview server).

### 1.5 Email deliverability (before go-live, not for testing)
- Default Supabase email works for test. For production set custom SMTP
  (Authentication → Emails) so confirm/reset mails actually land.

### 1.6 Collect the keys (Project Settings → API)
- **Project URL** → I need this (client + worker var).
- **anon public** key → I need this (goes in the app).
- **service_role** key → `wrangler secret put SUPABASE_SERVICE_KEY` (NEVER in
  the app, never pasted to me).

---

## 2 · Creem

> First confirm with Creem support that they **accept young-children
> educational content** as a category — do this before investing setup time.

### 2.1 Account + test mode
- creem.io → sign up → stay in **Test mode** for now.

### 2.2 Create 3 products (note each `prod_...` id)
| Plan | Type | Price | Notes |
|------|------|-------|-------|
| `annual`   | subscription | €89 / year   | 7-day free trial |
| `monthly`  | subscription | €11,99 / month | — |
| `lifetime` | one-time     | €199         | — |

### 2.3 API key (Developers → API key, **test**)
- `wrangler secret put CREEM_API_KEY_TEST`

### 2.4 Webhook (Developers → Webhooks → add endpoint)
- URL: `https://scribble-tts.donny-idzerda.workers.dev/billing/webhook`
- Subscribe these events: `checkout.completed`, `subscription.active`,
  `subscription.paid`, `subscription.canceled`, `subscription.expired`,
  `subscription.past_due`, `refund.created`, `dispute.created`.
- Copy the signing secret → `wrangler secret put CREEM_WEBHOOK_SECRET_TEST`

---

## 3 · Worker config

### 3.1 Secrets (run in `tts-worker/`)
```
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put CREEM_API_KEY_TEST
npx wrangler secret put CREEM_WEBHOOK_SECRET_TEST
```

### 3.2 Vars (edit `tts-worker/wrangler.toml`)
- Uncomment + set `SUPABASE_URL = "https://<YOUR-REF>.supabase.co"`
- Set `CREEM_PRODUCTS_TEST` to the 3 product ids:
  `'{"annual":"prod_..","monthly":"prod_..","lifetime":"prod_.."}'`
- `BILLING_PROVIDER="creem"` and `CREEM_ENV="test"` are already set.
- **Do not `wrangler deploy` yet** — the new worker pairs with the new app.

---

## 4 · Hand back to me (only these 3)
1. **Supabase Project URL** — `https://<ref>.supabase.co`
2. **Supabase anon public key** — the long `eyJ...` anon (not service_role) key
3. **The 3 Creem test product ids** — annual / monthly / lifetime

With those I wire the app, flip the feature flag on, and verify the full flow
(anon play → link account → multi-device sync → Creem test checkout → webhook →
entitlement → unlock → recovery by login → refund revoke).

---

## 5 · Go-live (later, after verification)
- Creem: switch to **Live mode**, recreate the 3 products, set live API key +
  webhook secret (`CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`), set
  `CREEM_PRODUCTS` (live ids), flip `CREEM_ENV="live"`.
- Supabase: custom SMTP, review RLS once more.
- `wrangler deploy` the worker **and** push the app in the same window.
- Rotate/revoke the old OpenAI/ElevenLabs/Lemon Squeezy keys (separate task).
