// Service Worker with Workbox 7.3.0 (Local) — Instant navigations + fast revalidation + prefetch capture

importScripts('/workbox/workbox-sw.js');

// Configure Workbox to use local files instead of CDN
workbox.setConfig({ modulePathPrefix: '/workbox/', debug: false });

// Immediate activation and control
self.skipWaiting();
workbox.core.clientsClaim();

// ----- Define modules and constants first -----
const { StaleWhileRevalidate, CacheFirst } = workbox.strategies;
const { precacheAndRoute } = workbox.precaching;
const { ExpirationPlugin } = workbox.expiration;
const { CacheableResponsePlugin } = workbox.cacheableResponse;
const CACHE_VERSION = 'v3';

// ----- Precache critical assets early (served cache-first by precaching) -----
precacheAndRoute([
  { url: '/', revision: CACHE_VERSION },
  { url: '/offline/index.html', revision: CACHE_VERSION },
  { url: '/manifest.json', revision: CACHE_VERSION },
  { url: '/site.webmanifest', revision: CACHE_VERSION }
]);

// ----- Enable Navigation Preload for navigations -----
workbox.navigationPreload.enable();

// ----- Navigations: instant cache + background update via preload -----
workbox.routing.registerRoute(
  ({ request, url }) => request.mode === 'navigate' && url.pathname !== '/offline/index.html',
  async ({ event, request }) => {
    const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
    const cached = await cache.match(request);

    // Preload nav response if available, else fall back to network
    const preloadPromise = event.preloadResponse;
    const networkPromise = fetch(request);

    if (cached) {
      // Return instantly; refresh in background using preload or network
      event.waitUntil((async () => {
        const fresh = (await preloadPromise) || (await networkPromise);
        if (fresh) await cache.put(request, fresh.clone());
      })());
      return cached;
    }

    // First visit or cache miss: prefer preload, else network, then cache it
    const response = (await preloadPromise) || (await networkPromise);
    if (response) {
      event.waitUntil(cache.put(request, response.clone()));
      return response;
    }
    return Response.error();
  }
);

// ----- Capture <link rel=prefetch> navigation prefetches and persist to pages cache -----
workbox.routing.registerRoute(
  ({ url, request }) => {
    // Same-origin GET prefetches signaled by Purpose/Sec-Purpose: prefetch header
    const isSameOrigin = url.origin === self.location.origin;
    const isGET = request.method === 'GET';
    const isPrefetchHeader =
      request.headers.get('Sec-Purpose') === 'prefetch' ||
      request.headers.get('Purpose') === 'prefetch';
    const isLowPriority = request.priority === 'low';
    const acceptsHTML = (request.headers.get('Accept') || '').includes('text/html');
    
    return isSameOrigin && isGET && acceptsHTML && (isPrefetchHeader || isLowPriority);
  },
  async ({ event, request }) => {
    // Pass through response but also persist it for instant future navigations
    const responsePromise = fetch(request);
    event.waitUntil((async () => {
      const res = await responsePromise;
      if (res && res.ok) {
        const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
        await cache.put(request, res.clone());
      }
    })());
    return responsePromise;
  }
);

// ----- CSS — Stale-While-Revalidate -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'style',
  new StaleWhileRevalidate({
    cacheName: `css-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 180 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- JavaScript — Stale-While-Revalidate -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'script',
  new StaleWhileRevalidate({
    cacheName: `js-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 180 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Images — Cache-First (instant) -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: `image-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 1200,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Fonts — Cache-First -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: `font-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Audio/Video — Cache-First + Range Requests -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'audio' || request.destination === 'video',
  new CacheFirst({
    cacheName: `media-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200, 206],
      }),
      new workbox.rangeRequests.RangeRequestsPlugin(),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 90 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Google Fonts — Cache-First -----
workbox.routing.registerRoute(
  ({ url }) =>
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: `google-fonts-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

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
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 600,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- API — Network-First (short TTL) -----
workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new workbox.strategies.NetworkFirst({
    cacheName: `api-cache-${CACHE_VERSION}`,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 10 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Same-origin catch-all (no destination) — SWR -----
workbox.routing.registerRoute(
  ({ url, request }) => url.origin === self.location.origin && !request.destination,
  new StaleWhileRevalidate({
    cacheName: `misc-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 600,
        maxAgeSeconds: 60 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Offline fallback -----
workbox.routing.setCatchHandler(async ({ event }) => {
  switch (event.request.destination) {
    case 'document':
    case '':
      return (await caches.match(event.request)) ||
             (await caches.match('/offline/index.html')) ||
             (await caches.match('/')) ||
             Response.error();
    case 'image':
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="#f0f0f0" width="200" height="200"/><text x="50%" y="50%" font-family="Arial,sans-serif" font-size="14" text-anchor="middle" dy=".3em" fill="#999">Offline</text></svg>',
        { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } }
      );
    default:
      return Response.error();
  }
});

// ----- Messaging: manual cache control + bulk prefetch hook -----
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();

  if (event.data?.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(`runtime-cache-${CACHE_VERSION}`).then((cache) => cache.addAll(event.data.payload))
    );
  }

  if (event.data?.type === 'PREFETCH_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
      await Promise.all(event.data.urls.map(async (u) => {
        try {
          const res = await fetch(u, { credentials: 'same-origin' });
          if (res && res.ok) await cache.put(u, res.clone());
        } catch (_) {}
      }));
    })());
  }

  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }
});

// ----- Activation: claim clients only (ExpirationPlugin handles expiration) -----
self.addEventListener('activate', (event) => {
  console.log('Service Worker activated with version:', CACHE_VERSION);
  event.waitUntil(self.clients.claim());
});

console.log('Service Worker loaded — Instant navigations + fast revalidation + prefetch capture');
