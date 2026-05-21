/* =========================================================================
   Scribble Heroes - Service Worker (PWA 2.0)
   Strategy:
     - App shell + same-origin assets: cache-first (instant, offline-proof)
     - Cross-origin CDNs (Tailwind, confetti): stale-while-revalidate
     - Navigations: network-first, fall back to cached app shell offline
   ========================================================================= */

const CACHE = 'scribble-heroes-v53';

// Everything needed to boot fully offline after the first visit.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // addAll is atomic; if a CDN hiccups we still cache the rest individually.
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navigations → network-first, offline fallback to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put('./index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cross-origin CDNs → stale-while-revalidate.
  if (!sameOrigin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            caches.open(CACHE).then((c) => c.put(request, res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Same-origin assets → cache-first.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
    )
  );
});
