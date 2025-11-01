// Service Worker with Workbox 7.3.0 (Local) — Instant navigations + fast revalidation
// Docs: https://developer.chrome.com/docs/workbox/

importScripts('/workbox/workbox-sw.js');

// Configure Workbox to use local files instead of CDN
workbox.setConfig({ modulePathPrefix: '/workbox/', debug: false });

// Immediate activation and control
self.skipWaiting();
workbox.core.clientsClaim();

// ---------- Define modules and constants FIRST ----------
const { StaleWhileRevalidate, CacheFirst } = workbox.strategies;
const { precacheAndRoute } = workbox.precaching;
const { ExpirationPlugin } = workbox.expiration;
const { CacheableResponsePlugin } = workbox.cacheableResponse;

const CACHE_VERSION = 'v2';

// ---------- Precache critical assets EARLY (cache-first for these) ----------
precacheAndRoute([
  { url: '/', revision: CACHE_VERSION },
  { url: '/offline/index.html', revision: CACHE_VERSION },
  { url: '/manifest.json', revision: CACHE_VERSION },
  { url: '/site.webmanifest', revision: CACHE_VERSION }
]); // Precached URLs are served cache-first by Workbox precaching [web:55]

// ---------- Enable Navigation Preload (used by our custom handler) ----------
workbox.navigationPreload.enable(); // Sets up the browser’s preloaded navigation request [web:9]

// ---------- Navigations: instant cache + background update via preload ----------
workbox.routing.registerRoute(
  ({ request, url }) => request.mode === 'navigate' && url.pathname !== '/offline/index.html',
  async ({ event, request }) => {
    const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
    const cached = await cache.match(request);

    // Kick off preload and a network fallback in parallel
    const preloadPromise = event.preloadResponse; // Promise<Response|null> for the preloaded navigation [web:8]
    const networkPromise = fetch(request); // Fallback if preload isn't available [web:8]

    if (cached) {
      // Return instantly; refresh cache in background using preload or network
      event.waitUntil((async () => {
        const fresh = (await preloadPromise) || (await networkPromise);
        if (fresh) await cache.put(request, fresh.clone());
      })()); // Tie async work to the event to avoid preload cancellation warning [web:8][web:67][web:75]
      return cached; // Instant render from cache (repeat visits) [web:27]
    }

    // First visit or cache miss: prefer preload, else network, then cache it
    const response = (await preloadPromise) || (await networkPromise);
    if (response) {
      event.waitUntil(cache.put(request, response.clone())); // Persist for next visit [web:67][web:75]
      return response;
    }

    // Offline fallback handled by setCatchHandler below if this errors
    return Response.error();
  }
); // Custom handler mixes SWR semantics with navigation preload cleanly [web:27][web:42]

// ---------- Runtime routes ----------

// 2. CSS — Stale-While-Revalidate
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'style',
  new StaleWhileRevalidate({
    cacheName: `css-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 180 * 24 * 60 * 60, purgeOnQuotaError: true })
    ]
  })
);

// 3. JavaScript — Stale-While-Revalidate
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'script',
  new StaleWhileRevalidate({
    cacheName: `js-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 180 * 24 * 60 * 60, purgeOnQuotaError: true })
    ]
  })
);

// 4. Images — Stale-While-Revalidate
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: `image-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 800, maxAgeSeconds: 365 * 24 * 60 * 60, purgeOnQuotaError: true })
    ]
  })
);

// 5. Fonts — Cache-First
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: `font-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 365 * 24 * 60 * 60, purgeOnQuotaError: true })
    ]
  })
);

// 6. Audio/Video — Cache-First + Range Requests
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'audio' || request.destination === 'video',
  new CacheFirst({
    cacheName: `media-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200, 206] }),
      new workbox.rangeRequests.RangeRequestsPlugin(),
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 90 * 24 * 60 * 60, purgeOnQuotaError: true })
    ]
  })
);

// 7. Google Fonts — Cache-First
workbox.routing.registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: `google-fonts-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 365 * 24 * 60 * 60, purgeOnQuotaError: true })
    ]
  })
);

// 8. Popular CDNs — Stale-While-Revalidate
workbox.routing.registerRoute(
  ({ url }) =>
    url.origin === 'https://cdn.jsdelivr.net' ||
    url.origin === 'https://cdnjs.cloudflare.com' ||
    url.origin === 'https://unpkg.com' ||
    url.origin === 'https://storage.googleapis.com',
  new StaleWhileRevalidate({
    cacheName: `cdn-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 365 * 24 * 60 * 60, purgeOnQuotaError: true })
    ]
  })
);

// 9. API — Network-First (short cache)
workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new workbox.strategies.NetworkFirst({
    cacheName: `api-cache-${CACHE_VERSION}`,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 10 * 60, purgeOnQuotaError: true })
    ]
  })
);

// 10. Same-origin catch-all (no destination) — SWR
workbox.routing.registerRoute(
  ({ url, request }) => url.origin === self.location.origin && !request.destination,
  new StaleWhileRevalidate({
    cacheName: `misc-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 24 * 60 * 60, purgeOnQuotaError: true })
    ]
  })
);

// ---------- Offline fallback ----------
workbox.routing.setCatchHandler(async ({ event }) => {
  switch (event.request.destination) {
    case 'document':
      return (await caches.match('/offline/index.html')) || (await caches.match('/')) || Response.error();
    case 'image':
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="#f0f0f0" width="200" height="200"/><text x="50%" y="50%" font-family="Arial,sans-serif" font-size="14" text-anchor="middle" dy=".3em" fill="#999">Offline</text></svg>',
        { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } }
      );
    default:
      return Response.error();
  }
});

// ---------- Messaging for manual cache control ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();

  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(`runtime-cache-${CACHE_VERSION}`).then((cache) => cache.addAll(event.data.payload))
    );
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => Promise.all(cacheNames.map((name) => caches.delete(name))))
    );
  }
});

// ---------- Activation: clean up old caches ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => (name.includes('-cache-') || name === 'my-cache' || name === 'image-cache' || name === 'runtime-cache') && !name.endsWith(CACHE_VERSION))
            .map((name) => caches.delete(name))
        )
      ),
      self.clients.claim()
    ])
  );
});

console.log('Service Worker loaded with Workbox 7.3.0 — Instant navigations + fast revalidation');
