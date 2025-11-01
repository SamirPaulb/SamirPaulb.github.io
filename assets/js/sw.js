// Service Worker with Workbox 7.3.0 (Local) — Instant navigations + fast revalidation + prefetch capture (performance-optimized)

importScripts('/workbox/workbox-sw.js');

// Configure Workbox to use local files instead of CDN
workbox.setConfig({ modulePathPrefix: '/workbox/', debug: false });

// Immediate activation and control
self.skipWaiting();
workbox.core.clientsClaim();

// ----- Define modules and constants first -----
const { StaleWhileRevalidate, CacheFirst } = workbox.strategies;
const { precacheAndRoute, getCacheKeyForURL } = workbox.precaching;
const { ExpirationPlugin } = workbox.expiration;
const { CacheableResponsePlugin } = workbox.cacheableResponse;
const CACHE_VERSION = 'v4'; // bump on changes

// Normalize a URL/pathname (remove trailing slash except for root)
const normalizePath = (pathOrUrl) => {
  const pathname = new URL(pathOrUrl, self.location.origin).pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
};

// Offline URL variants
const OFFLINE_PATHS = ['/offline', '/offline/index.html'];
const OFFLINE_NORMALIZED = new Set(OFFLINE_PATHS.map(normalizePath));
const isOfflinePath = (urlLike) => OFFLINE_NORMALIZED.has(normalizePath(urlLike));

// ----- Precache critical assets early (served cache-first by precaching) -----
precacheAndRoute([
  { url: '/offline/index.html', revision: CACHE_VERSION },
  { url: '/manifest.json', revision: CACHE_VERSION },
  { url: '/site.webmanifest', revision: CACHE_VERSION }
]); // Precached URLs are served cache-first by Workbox’s precaching route [web:55]

// NOTE: Navigation Preload is intentionally disabled here for max “instant” feel with SWR.
// It primarily benefits NetworkFirst and otherwise introduces unnecessary work for cached navigations. [web:9]

// ----- Navigations: Stale-While-Revalidate (instant cache, background refresh) -----
workbox.routing.registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !isOfflinePath(url),
  new StaleWhileRevalidate({
    cacheName: `pages-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      // TTL + size limit for pages
      new ExpirationPlugin({
        maxEntries: 800,                 // adjust as needed
        maxAgeSeconds: 60 * 24 * 60 * 60, // 60 days
        purgeOnQuotaError: true
      })
    ]
  })
); // SWR returns cached HTML immediately and revalidates without blocking navigation [web:16]

// ----- Capture <link rel=prefetch> HTML and persist to pages cache -----
workbox.routing.registerRoute(
  ({ url, request }) => {
    const isSameOrigin = url.origin === self.location.origin;
    const isGET = request.method === 'GET';
    const acceptsHTML = (request.headers.get('Accept') || '').includes('text/html');
    const isPrefetchHeader =
      request.headers.get('Sec-Purpose') === 'prefetch' ||
      request.headers.get('Purpose') === 'prefetch';
    return isSameOrigin && isGET && acceptsHTML && isPrefetchHeader && !isOfflinePath(url);
  },
  async ({ event, request }) => {
    // Store prefetched pages for instant future navigations
    try {
      const response = await fetch(request);
      if (response && response.ok && response.status === 200) {
        event.waitUntil((async () => {
          const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
          await cache.put(request, response.clone());
        })());
      }
      return response;
    } catch {
      // Prefetch failures are non-critical; ignore
      return fetch(request);
    }
  }
); // Extends speculative loads into SW cache for real instant clicks later [web:21]

// ----- CSS — Cache-First (fastest repeat loads) -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'style',
  new CacheFirst({
    cacheName: `css-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 400,
        maxAgeSeconds: 180 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
); // Cache-first gives the quickest repeat paints for styles on static sites [web:16]

// ----- JavaScript — Cache-First (fastest repeat loads) -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'script',
  new CacheFirst({
    cacheName: `js-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 400,
        maxAgeSeconds: 180 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
); // Cache-first avoids blocking on network for JS on repeat visits [web:16]

// ----- Images — Cache-First (instant) -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: `image-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 1500,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
); // Ideal for static image assets where freshness is not critical [web:16]

// ----- Fonts — Cache-First -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: `font-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
); // Fonts rarely change; cache-first minimizes FOIT/FOUC on repeat loads [web:16]

// ----- Audio/Video — Cache-First + Range Requests -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'audio' || request.destination === 'video',
  new CacheFirst({
    cacheName: `media-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200, 206] }),
      new workbox.rangeRequests.RangeRequestsPlugin(),
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 90 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
); // Properly supports partial content for media while maximizing repeat performance [web:16]

// ----- Google Fonts — Cache-First -----
workbox.routing.registerRoute(
  ({ url }) =>
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: `google-fonts-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
); // CDN fonts are ideal for cache-first with long TTLs on static sites [web:16]

// ----- Popular CDNs — Stale-While-Revalidate -----
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
      new ExpirationPlugin({
        maxEntries: 800,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
); // SWR keeps CDN assets fresh while serving instantly from cache [web:16]

// ----- API — Network-First (short TTL) -----
workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new workbox.strategies.NetworkFirst({
    cacheName: `api-cache-${CACHE_VERSION}`,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 10 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
); // Network-first is appropriate for APIs with short-lived cache for resilience [web:16]

// ----- Same-origin catch-all (no destination) — SWR -----
workbox.routing.registerRoute(
  ({ url, request }) => url.origin === self.location.origin && !request.destination && !isOfflinePath(url),
  new StaleWhileRevalidate({
    cacheName: `misc-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 800,
        maxAgeSeconds: 60 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
); // Covers other same-origin requests with instant responses plus background refresh [web:16]

// ----- Offline fallback for navigations -----
workbox.routing.setCatchHandler(async ({ event }) => {
  if (event.request.destination === 'document' || event.request.mode === 'navigate') {
    const offlineResponse =
      (await caches.match('/offline/index.html')) ||
      (await caches.match(getCacheKeyForURL('/offline/index.html')));
    if (offlineResponse) {
      const headers = new Headers(offlineResponse.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      headers.set('Expires', '0');
      return new Response(offlineResponse.body, {
        status: offlineResponse.status,
        statusText: offlineResponse.statusText,
        headers
      });
    }
    return new Response('Offline - No cached version available', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
  return Response.error();
}); // Standard offline fallback pattern for navigations with precached HTML [web:155]

// ----- Messaging: optional manual warmup/clear -----
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();

  if (event.data?.type === 'PREFETCH_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
      await Promise.all(
        event.data.urls.map(async (u) => {
          try {
            const res = await fetch(u, { credentials: 'same-origin' });
            if (res && res.ok) await cache.put(u, res.clone());
          } catch {}
        })
      );
    })());
  }

  if (event.data?.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }
});

// ----- Activation: claim clients only (let ExpirationPlugin handle TTL) -----
self.addEventListener('activate', (event) => {
  // eslint-disable-next-line no-console
  console.log('Service Worker activated with version:', CACHE_VERSION);
  event.waitUntil(self.clients.claim());
}); // Keep activate fast; rely on ExpirationPlugin for TTL and size limits [web:21]

console.log('Service Worker loaded — Instant navigations + fast revalidation + prefetch capture (performance-optimized)');
