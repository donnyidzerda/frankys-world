# Verwerkersregister & DPA-checklist — Franky's World

Verwerkingsverantwoordelijke: **Donny Idzerda**, Amperestraat 11, Kudelstaart, KvK 72255269 · info@skep.co.
Dit is je AVG art. 30 register (verwerkingen) + de DPA-status per verwerker. Houd bij; toon op verzoek aan de AP.

## Wat we verwerken (samenvatting)
| Gegeven | Doel | Grondslag | Opslag | Bewaartermijn |
|---|---|---|---|---|
| Voornaam + leeftijd kind | App personaliseren | Uitvoering overeenkomst | Lokaal (device) + optioneel sync (Cloudflare KV) | Tot wissen door gebruiker / account inactief |
| Leervoortgang (sterren, mastery, tekeningen) | Voortgang bewaren | Uitvoering overeenkomst | Lokaal + optioneel sync | idem |
| Spraak goed/fout-uitkomst | Leesoefening | Gerechtvaardigd belang | **Alleen lokaal** | Lokaal |
| Stem-audio/transcript | (n.v.t. — verlaat device nooit) | — | **Nooit verzonden** | — |
| Ouder-e-mail + betaalgegevens | Betaling premium | Uitvoering overeenkomst | Bij Paddle (MoR) | Per Paddle-beleid |
| Entitlement (premium ja/nee, syncId) | Toegang premium | Uitvoering overeenkomst | Cloudflare KV | Account-leven |

Geen advertenties, geen tracking, geen profilering, geen verkoop van data.

## Verwerkers (DPA-status — afronden vóór scale)
| Verwerker | Rol | DPA | Datalocatie | Actie |
|---|---|---|---|---|
| **Cloudflare** (Workers/KV/DO) | Hosting, sync-opslag, TTS-proxy | DPA via Cloudflare-voorwaarden (accepteren in dashboard) | EU mogelijk (KV global) | ☐ DPA bevestigen + EU-data waar kan |
| **Paddle.com Market Ltd** | Merchant of Record: betalingen, btw, abonnementen | Paddle is MoR → eigen verwerkersrol; DPA in Paddle-account | UK/EU | ☐ DPA/voorwaarden accepteren in Paddle |
| **ElevenLabs** | TTS-generatie (vaste zinnen, geen PII) | DPA via ElevenLabs | US/EU | ☐ DPA bevestigen; bevestig geen PII in input |
| **OpenAI** | TTS-fallback (vaste zinnen, geen PII) | DPA via OpenAI (Zero-retention API mogelijk) | US | ☐ DPA + zero-retention aanvragen |
| **GitHub Pages** | Statische hosting app + landing | Microsoft/GitHub voorwaarden | US/CDN | ☐ akkoord voorwaarden |

> Sleutels die ooit chat-historie zagen (OpenAI/ElevenLabs) rouleren vóór publieke launch (zie GO-LIVE.md).

## Datalek / rechten
- **Datalek:** binnen 72u melden bij AP indien risico; betrokkenen informeren bij hoog risico. Houd een incidentenlog.
- **Verzoeken (inzage/verwijdering):** snelste route = in-app "Verwijder al mijn gegevens" (lokaal + cloud). Overig: info@skep.co.
- **Verwerkersregister** = dit bestand. Update bij elke nieuwe verwerker/verwerking.

## Nog te doen (jurist / jij)
- ☐ Kinder-privacy/consumentenrecht jurist: review privacy/terms/refund (NL + EN/ES) — €3–8k vaste scope.
- ☐ GDPR-K leeftijdsgrens-consent (NL 16): formeel ouder-consent vastleggen indien nodig.
- ☐ DPA's per verwerker accepteren/tekenen (checklist hierboven).
- ☐ COPPA-traject als je in de VS verkoopt.
