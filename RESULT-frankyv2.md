# RESULT — Franky's World staged at frankyv2.skep.co (2026-06-10)

**Live: https://frankyv2.skep.co** — TLS via certbot, HTTP→HTTPS redirect on.
The original at frankysworld.skep.co (GitHub Pages) is untouched and remains
the rollback. Promotor, v2.skep.co and the skep.co vhost verified unaffected.

## Source

`git clone https://github.com/donnyidzerda/frankys-world` → `~/apps/frankysworld`.
The repo is already flat static — **no build pipeline existed** (no
package.json, no bundler), so no mirroring was needed: every file the PWA
uses was diffed against its live URL and came back **byte-identical**
(`/`, `index.html`, `manifest.webmanifest`, `sw.js`, `icon-180.png`,
`icon.svg`). The clone is the canonical source; no import commit was
required because the repo history *is* the source of the live site.

## Files served (the whole app)

| File | Role | Cache-Control |
| --- | --- | --- |
| `index.html` | the entire app (single file, hand-rolled CSS + vanilla JS) | `no-cache` |
| `sw.js` | service worker (cache `frankys-world-v132`) | `no-cache` |
| `manifest.webmanifest` | PWA manifest (served as `application/manifest+json`) | `no-cache` |
| `icon-180.png`, `icon.svg` | icons (HTML + manifest) | `max-age=31536000, immutable` |

CDN dependencies precached by the SW (verified reachable): canvas-confetti,
supabase-js, Google Fonts css2 (Fredoka + Nunito).

Not served (403 by nginx rule): the `*.md` docs, `supabase/`, `tts-worker/`,
dotfiles/`.git`. `landing.html`, `privacy/terms/refund-*.html` remain
reachable by direct URL, same as on Pages.

## nginx

New vhost `/etc/nginx/sites-available/frankyv2` only — static `root` pointing
at the repo. `www-data` was granted traverse access to `/home/deploy` via a
precise ACL (`setfacl -m u:www-data:x /home/deploy`), not a chmod.

## Origin/scope adjustments needed: none

`sw.js`, the manifest (`start_url`/`scope` = `./`) and all asset references
are relative — nothing hardcodes the old origin, so zero changes were made
to app files. The `CNAME` file (GitHub Pages artifact) is inert here.

## How to edit

1. Edit the file (usually `index.html`) in `~/apps/frankysworld`.
2. **Bump the SW cache version** in `sw.js` (`frankys-world-v132` → `v133`)
   — without this, installed iPads keep serving the old cached shell.
3. Commit, then refresh. On this box the edit is live immediately
   (`./deploy.sh` = `git pull`, for when edits come via GitHub instead).

## Verification results

- All 6 app files byte-identical to https://frankysworld.skep.co over HTTPS.
- MIME: `.webmanifest` → `application/manifest+json`; SW → `application/javascript`.
- Cache headers as in the table above (update path through the SW works:
  index + SW revalidate every load).
- PWA installability: manifest reachable with correct type, `display:
  fullscreen`, icons 200, SW served from the origin root scope — the
  Lighthouse-level install criteria are met; a real iPad add-to-home-screen
  test is the one check that needs a human.
- Cutover to the real domain only on your word (it's a DNS/CNAME change;
  this vhost can take the real hostname then).
