# Franky's World — Commercialization Plan
**Target: €1M ARR minimum. Working doc, not investor-facing yet.**

This plan is specific to the current stack: single-file vanilla PWA, Cloudflare
Workers + Durable Objects + KV, ElevenLabs + OpenAI TTS, GitHub Pages hosting.
Code is ~20% of the work — legal/compliance, content, pricing, distribution and
growth dominate.

---

## 0. The €1M ARR math (pick a target, work back)

| Price (annual) | Paying families needed | Free users @ 3% conv. | @ 5% conv. |
|---|---|---|---|
| €49/yr (€4.08/mo) | 20,400 | 680,000 | 408,000 |
| €69/yr (€5.75/mo) | 14,500 | 483,000 | 290,000 |
| €89/yr (€7.42/mo) | 11,240 | 375,000 | 225,000 |

Reference points: Reading Eggs ~$9.99/mo, Homer ~$9.99/mo, Lingokids ~$14.99/mo,
Duolingo ABC free. Kids-reading subscriptions sustain €60–120/yr.

**Recommended target:** €69/yr (or €8.99/mo monthly option). To €1M ARR =
**~14.5k paying families**. Achievable with a good product + focused growth in
1–3 years. Everything below sizes to that.

---

## 1. Positioning & moat

- **One-liner:** "The calm, ad-free app where toddlers learn to read, write and
  draw — guided by Franky." 
- **Wedge:** the reading engine (Mentava/Hoven-style mastery + decoding + speech
  verification) is genuinely differentiated vs. "edutainment" apps. Lead with
  *learning outcomes*, not games.
- **Moat:** (a) no ads / no tracking = trust (rare and defensible in kids), (b)
  offline-first PWA, (c) multilingual from day one, (d) the curriculum depth.
- **Beachhead market:** Netherlands/Flanders first (NL native, your network,
  cheaper to test), then EN and ES. NL is small (~€ niche) so plan the EN
  expansion early — that's where the €1M scale lives.

---

## 2. Pricing & packaging

- **Free tier:** letters A–Z, first ~3 reading sounds, free-draw, 1 child
  profile. Enough to prove value + rank in stores.
- **Premium (€69/yr or €8.99/mo):** full reading curriculum (all sounds, words,
  sentences, sight words), all worlds, multiple child profiles, cross-device
  sync, parent dashboard, printable sheets.
- **Family/founder lifetime** (€149 one-time, limited) — early cash + advocates.
- **Annual default, monthly available.** Annual = better LTV + cashflow. 7-day
  free trial → card required (higher conversion) or no-card trial (more
  top-of-funnel). Test both.
- Entitlement = a single boolean per account synced via the existing DO/KV.

---

## 3. Legal & compliance — THE blocker (do first, with a lawyer)

Children's apps are the most regulated consumer software. Get a specialist
privacy lawyer (NL/EU + US) for a fixed-scope review (~€3–8k). Non-negotiable.

- **GDPR + GDPR-K (EU):** lawful basis, data minimization, parental consent for
  under-16 (varies 13–16 by country), right to access/delete, DPA with every
  processor (Cloudflare, OpenAI, ElevenLabs, Stripe), records of processing,
  EU data residency where possible.
- **UK Age Appropriate Design Code (Children's Code):** high-privacy defaults,
  no nudge techniques, no profiling — you already comply by design (no ads/
  tracking). Document it; it's a selling point.
- **COPPA (US):** verifiable parental consent before collecting personal info
  from under-13; privacy policy; no behavioral ads. Required for US launch +
  Apple/Google Kids categories.
- **Apple App Store Kids Category rules:** no third-party analytics/ads SDKs,
  parental gate for purchases/external links, strict. You're well-positioned.
- **Voice recordings = sensitive.** The speech-recognition transcripts
  (`readHeard`) are children's voice-derived data. For commercial:
  - Keep recognition **on-device** (Web Speech API already is) — never send
    audio to a server.
  - Reconsider syncing `readHeard` transcripts to KV/DO. Safer: keep them
    device-local, or make them opt-in with explicit parental consent, or store
    only the pass/fail boolean (drop the transcript text). **Recommend: drop
    the transcript, sync only the boolean.**
- **Deliverables:** Privacy Policy, Terms, Parental Consent flow, Cookie/Data
  notice (you set none — easy), DPA register, a "delete my family's data"
  button (you have per-profile delete; add account-level delete).

---

## 4. Product gaps to close before paid launch

- [ ] **Default voice only** — remove the cloned "Loïs" voice (can't ship one
      parent's voice commercially). Premade per-language voices already wired.
- [ ] **Pre-generated audio corpus** (see §6) — kills per-user TTS cost and
      makes pronunciation 100% consistent + fully offline.
- [ ] **Accounts + billing + entitlement gating** (see §5).
- [ ] **Account-level data export + delete** (legal).
- [ ] **Onboarding/first-run** that sells the value in 60 seconds.
- [ ] **Parent dashboard** worth paying for: progress over time, what Lucy
      mastered this week, suggested next step (you have the data: readBox,
      readLat, readHeard, completed).
- [ ] **Content depth** for retention (see §8) — a 2-week curriculum churns.
- [ ] **QA matrix**: iOS Safari (PWA), iPadOS, Android Chrome, desktop;
      offline; low-end devices.
- [ ] **Accessibility pass** (color-only feedback, tap targets, captions).

---

## 5. Accounts, auth, billing, entitlements

- **Account = the parent.** Child profiles live under it (you already have
  multi-profile). The parent gate already exists.
- **Auth:** passwordless **email magic-link** (simplest, no password storage)
  and/or **Sign in with Apple/Google**. Build on the existing Worker; store
  accounts in KV/DO or move to a managed DB (Cloudflare D1 / Turso / Supabase)
  once you need queries (billing, admin).
- **Billing:** **Stripe** for the web/PWA path (Checkout + Customer Portal +
  webhooks → set entitlement). No app-store cut.
- **App-store reality:** if you ship via the App Store / Play, Apple/Google
  generally require **their IAP** (15–30% cut) for digital subscriptions, and
  forbid steering to web payment inside the app. Three options:
  1. **Web-first (recommended to start):** sell only on the website (Stripe),
     keep PWA + "Add to Home Screen". Pros: full margin, fast. Cons: no store
     discovery.
  2. **Hybrid:** wrap with **Capacitor** for store presence + discovery, use
     **IAP** inside the app, Stripe on web. Reconcile entitlement server-side.
  3. **Store apps with IAP only.** Simplest store story, 15% cut (Apple Small
     Business Program under $1M), but you rebuild purchase flow per platform.
- **Entitlement service:** one Worker endpoint `/entitlement?account=…`
  returning `{premium: bool, until: ts}`, set by Stripe/IAP webhooks, cached
  client-side, enforced on premium screens. Fail-open to free, never lock a
  paid child out offline.

---

## 6. Voice & TTS cost model at scale (margin maker)

Today every phrase is generated at runtime and cached per device. At 100k users
that's a lot of duplicate generation and a real bill.

- **Pre-generate the fixed corpus ONCE.** Every letter sound, word, sentence,
  sight word, prompt and praise line is a finite set (a few thousand clips per
  language). Generate them all, store as static MP3 in **Cloudflare R2** behind
  the CDN, ship URLs. Marginal cost per user → ~€0. Consistency → perfect.
  Offline → trivial (precache the set the child needs).
- **Only the child's name is dynamic.** Generate name clips on demand (tiny),
  or speak praise without the name, or stitch a cached name clip.
- **Build step:** a script that walks READING + SOUND + I18N praise/prompts ×
  3 languages × teach/chat, calls ElevenLabs once each, writes
  `audio/{lang}/{hash}.mp3` to R2, and a manifest the client maps to. Bump a
  corpus version to regenerate when content changes.
- **Net effect:** TTS becomes a fixed build cost (tens of €, once per content
  change), not a per-user variable cost. This is what makes the margin work.
- Keep OpenAI as the generation-time fallback only.

---

## 7. Infrastructure & scale

- **Hosting:** migrate GitHub Pages → **Cloudflare Pages** (custom domain, same
  account as Workers/DO/KV/R2, better cache/headers control). Buy a domain
  (e.g. frankysworld.com / frankys.world) — check trademark + the existing
  "Franky's World" Steam game (different category, low risk, but clear it with
  the lawyer before spending on brand).
- **Already scalable:** Durable Objects (one per profile, hibernate idle) +
  KV + R2 are built for millions. Add: rate-limiting on Worker endpoints,
  abuse guards on `/sync/new` and `/tts`, basic WAF.
- **Observability:** Cloudflare Analytics + a privacy-respecting error logger
  (Sentry with PII scrubbing, or self-host). No third-party trackers.
- **Backups:** periodic export of KV/DO state; R2 is durable.
- **Secrets/keys:** already encrypted secrets. Rotate the keys that ever
  touched chat history (OpenAI + ElevenLabs) before public launch.

---

## 8. Content & curriculum depth (retention = revenue)

A subscription dies without a runway of content. Build a content pipeline so
non-engineers can add lessons (data-driven, you already are).

- **Reading:** expand decodable words, sight words, sentences → short decodable
  **books/stories**. Add levels/units with a visible map of progress.
- **Writing:** numbers 1–20, uppercase + lowercase mastery, simple words,
  first name.
- **Drawing:** more guided drawings, seasonal packs (cheap engagement bumps).
- **Worlds:** more biomes as long-horizon progression (pattern exists).
- **Per-language parity:** EN and ES need the same depth as NL to sell abroad.
- **Pedagogy credibility:** a short "method" page + ideally a nod from an
  educator/SLT; consider a small efficacy study later (strong marketing asset).

---

## 9. Distribution

- **Web first:** SEO landing site (separate from the app) — "leren lezen app
  peuters", "learn to read toddler app". Blog/parent content for organic.
- **PWA install** prompts (you have the manifest + icon now).
- **App stores (phase 2):** Capacitor wrap → App Store + Play, Kids category.
  ASO: title, screenshots, preview video, keywords per locale.
- **Reviews/ratings** prompts at happy moments (after a finished session, never
  mid-task).

---

## 10. Analytics & metrics (privacy-respecting, first-party only)

Build a tiny first-party event pipe to your own Worker (no third-party SDKs):
- **Activation:** % who finish first reading session.
- **Funnel:** install → profile → first lesson → trial → paid.
- **Engagement:** sessions/week, minutes, streak, lessons mastered.
- **Retention:** D1/D7/D30, weekly cohort curves.
- **Monetization:** trial start, trial→paid, MRR, churn, LTV, CAC payback.
- **North-star:** weekly active *learning* children (sessions with mastery
  progress), not just opens.

---

## 11. Growth / acquisition

- **Organic:** parent SEO content, "free learn-to-read" tier ranking, school/
  speech-therapist word of mouth, Reddit/parenting communities (carefully).
- **Referral:** "give a month, get a month" — you already have family sharing
  primitives.
- **Paid:** Meta/Instagram + TikTok (parents), Apple Search Ads (high intent).
  Track CAC; keep CAC payback < 12 months (at €69/yr LTV ~€100–150 with
  retention, CAC target < €25–40).
- **Partnerships:** preschools, libraries, pediatric/SLT channels, B2B2C
  bundles. NL: consultatiebureau / kinderopvang pilots.
- **PR:** "Dutch dad builds ad-free reading app for his kids" — a real,
  tellable founder story.

---

## 12. Support & ops

- Help center / FAQ, a support email, refund policy, churn-save flow.
- Status page for the Worker/sync.
- A roadmap + changelog (you already version every release).

---

## 13. Company / finance

- **Entity:** NL **BV** (liability + cleaner contracts + investment-ready).
  ~€1–2k to set up.
- **Banking, accounting, VAT (BTW/OSS for EU digital sales), Stripe Tax** for
  automated VAT on subscriptions.
- **Trademark** "Franky's World" (+ logo) in relevant classes/regions; clear
  vs. existing uses first.
- **Insurance:** professional/cyber liability (handling kids' data).
- **Cap table / funding:** bootstrappable to first revenue; raise only to
  accelerate growth once CAC payback is proven.

---

## 14. Phased roadmap & sequencing

**Phase A — Make it sellable (foundations).** ~6–10 weeks.
1. Remove cloned voice; lock premade per-language voices.
2. Pre-generated audio corpus → R2 + manifest (margin + offline + consistency).
3. Accounts (magic-link) + Stripe subscription + entitlement gating.
4. Account-level data export/delete; drop transcript from sync (boolean only).
5. Migrate to Cloudflare Pages + custom domain.
6. Legal pack: privacy policy, terms, parental consent, DPAs. (Parallel, lawyer.)
7. Rotate exposed API keys.

**Phase B — Make it worth paying for (retention).** ~6–12 weeks, overlaps A.
8. Parent dashboard (progress over time, weekly summary, next step).
9. Content depth: reading units + decodable stories; EN/ES parity.
10. First-party analytics + funnel instrumentation.
11. Onboarding/first-run + paywall + trial.

**Phase C — Get users (growth).** ongoing.
12. SEO landing site + content; PWA install funnel.
13. Capacitor wrap → App Store + Play (Kids category), ASO.
14. Referral + paid acquisition; measure CAC/LTV; scale what pays back.

**Phase D — Scale & harden.** ongoing.
15. Rate-limits, WAF, monitoring, backups, on-call basics.
16. Localization beyond NL/EN/ES as demand shows.
17. Efficacy study + PR for credibility.

---

## 15. Cost to launch & run (rough)

**One-time / setup:** lawyer €3–8k · BV + admin €1–2k · domain + trademark
€1–3k · brand/landing design €1–5k · audio corpus generation €0.1–1k.
→ ~€6–19k to be launch-ready (excluding your time).

**Monthly run (early):** Cloudflare (Workers/DO/KV/R2/Pages) ~€5–50 ·
ElevenLabs (only on content changes, pre-generated) ~€0–22 · OpenAI fallback
~€0–10 · Stripe 1.5%+€0.25/txn · Sentry/monitoring ~€0–26 · email (magic-link)
~€0–15 · accounting ~€50–150.
→ **~€100–300/mo** until volume — the pre-generated corpus is why infra stays
cheap. Variable cost per paying family is cents; gross margin > 95%.

**To €1M ARR:** dominant cost becomes **CAC** (paid acquisition) and **content/
people**, not infra. Budget for marketing + a part-time content/curriculum
person as revenue allows.

---

## 16. Top risks & mitigations

1. **Kids privacy law** → lawyer first; you're already ad/tracker-free (huge
   head start); drop voice transcripts from sync.
2. **Cloned-voice can't ship** → premade voices + pre-generated corpus (done/
   planned).
3. **TTS cost at scale** → pre-generate the fixed corpus (turns variable into
   fixed). 
4. **App-store 30% + payment rules** → web-first Stripe; store apps as phase 2.
5. **Retention/churn** → content depth + parent dashboard + visible progress.
6. **NL market too small for €1M** → EN/ES parity + international growth early.
7. **Brand collision** ("Franky's World" Steam game) → trademark clearance
   before spending on brand; have a fallback name ready.
8. **Single-founder bandwidth** → sequence ruthlessly (Phase A first), automate
   (pre-generated audio, self-serve billing), outsource legal/design.

---

### Immediate next 5 (highest leverage, mostly buildable now)
1. Pre-generated audio corpus → R2 (margin + consistency + offline). *(I can build.)*
2. Remove cloned voice from the worker. *(I can build — 1 line.)*
3. Accounts (magic-link) + Stripe + entitlement gating. *(I can build.)*
4. Drop voice transcript from sync (boolean only). *(I can build.)*
5. Engage a kids-privacy lawyer + buy domain + start BV. *(You.)*
