# Verwerkersregister & DPA-checklist - Franky's World

Verwerkingsverantwoordelijke: **Donny**, KvK 72255269 · info@skep.co.
Dit is je AVG art. 30 register (verwerkingen) + de DPA-status per verwerker. Houd bij; toon op verzoek aan de AP.

## Wat we verwerken (samenvatting)
| Gegeven | Doel | Grondslag | Opslag | Bewaartermijn |
|---|---|---|---|---|
| Voornaam + leeftijd kind | App personaliseren | Uitvoering overeenkomst | Lokaal (device) + cloud-sync (Supabase, EU/Ierland) | Tot wissen door gebruiker |
| Leervoortgang (sterren, mastery, tekeningen) | Voortgang bewaren + herstel na apparaatverlies | Uitvoering overeenkomst | Lokaal + cloud-sync (Supabase, EU/Ierland) | idem |
| Spraak goed/fout-uitkomst | Leesoefening | Gerechtvaardigd belang | **Alleen lokaal** | Lokaal |
| Stem-audio/transcript | (n.v.t. - verlaat device nooit) | - | **Nooit verzonden** | - |
| Account-id (anoniem) | Data + premium koppelen aan een herstelbaar account | Uitvoering overeenkomst | Supabase Auth (EU/Ierland) | Tot account-verwijdering |
| Ouder-e-mail + wachtwoord (optioneel) | Account beveiligen/herstellen over apparaten | Uitvoering overeenkomst | Supabase Auth (EU/Ierland) | Tot account-verwijdering |
| Ouder-betaalgegevens | Betaling premium | Uitvoering overeenkomst | Bij Creem (MoR) | Per Creem-beleid |
| Entitlement (premium ja/nee, account-id) | Toegang premium | Uitvoering overeenkomst | Supabase (EU/Ierland) | Account-leven |

> **Let op - cloud-sync staat standaard aan (anoniem).** Vanaf het eerste gebruik krijgt elk kindprofiel een **anoniem** account-id en wordt voornaam + leervoortgang naar Supabase (EU) gesynct, zodat data een apparaatverlies/herinstallatie overleeft. Een e-mailadres is **optioneel** en alleen nodig om het account te beveiligen/herstellen. Geen e-mail = nog steeds een (anoniem) cloud-record. "Verwijder al mijn gegevens" wist lokaal én cloud.

Geen advertenties, geen tracking, geen profilering, geen verkoop van data.

## Verwerkers (DPA-status - afronden vóór scale)
| Verwerker | Rol | DPA | Datalocatie | Actie |
|---|---|---|---|---|
| **Supabase** (Auth + Postgres + Realtime) | Accounts (anoniem→e-mail/SSO), cloud-opslag leervoortgang, entitlement-opslag | DPA via Supabase (supabase.com/legal/dpa) | **EU - AWS eu-west-1 (Ierland)** | ☐ DPA accepteren; SMTP + e-mailconfirm aan vóór launch |
| **Cloudflare** (Workers) | TTS-proxy + billing-webhook relay (geen opslag van PII meer) | DPA via Cloudflare-voorwaarden | EU mogelijk | ☐ DPA bevestigen |
| **Creem** | Merchant of Record: betalingen, btw, abonnementen | Creem is MoR → eigen verwerkersrol; DPA/voorwaarden in Creem-account | EU/US (controleer) | ☐ DPA/voorwaarden accepteren; bevestig acceptatie kinder-educatie-categorie; bevestig exacte juridische entiteit voor de documenten |
| **ElevenLabs** | TTS-generatie (vaste zinnen, geen PII) | DPA via ElevenLabs | US/EU | ☐ DPA bevestigen; bevestig geen PII in input |
| **OpenAI** | TTS-fallback (vaste zinnen, geen PII) | DPA via OpenAI (Zero-retention API mogelijk) | US | ☐ DPA + zero-retention aanvragen |
| **GitHub Pages** | Statische hosting app + landing | Microsoft/GitHub voorwaarden | US/CDN | ☐ akkoord voorwaarden |

> Sleutels die ooit chat-historie zagen (OpenAI/ElevenLabs + de Creem **test**-key) rouleren vóór publieke launch (zie GO-LIVE.md). De Supabase service-role-key en Creem-keys staan als Worker-secrets, nooit in de app/repo.

## Datalek / rechten
- **Datalek:** binnen 72u melden bij AP indien risico; betrokkenen informeren bij hoog risico. Houd een incidentenlog.
- **Verzoeken (inzage/verwijdering):** snelste route = in-app "Verwijder al mijn gegevens" (lokaal + cloud). Overig: info@skep.co.
- **Verwerkersregister** = dit bestand. Update bij elke nieuwe verwerker/verwerking.

## Nog te doen (jurist / jij)
- ☐ Kinder-privacy/consumentenrecht jurist: review privacy/terms/refund (NL + EN/ES) - €3-8k vaste scope.
- ☐ GDPR-K leeftijdsgrens-consent (NL 16): formeel ouder-consent vastleggen indien nodig.
- ☐ DPA's per verwerker accepteren/tekenen (checklist hierboven).
- ☐ COPPA-traject als je in de VS verkoopt.
