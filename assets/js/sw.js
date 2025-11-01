// Service Worker with Workbox 7.3.0 (Local) - Optimized for Performance & SEO
// Documentation: https://developer.chrome.com/docs/workbox/
importScripts('/workbox/workbox-sw.js');

// Configure Workbox to use local files instead of CDN
workbox.setConfig({
  modulePathPrefix: '/workbox/',
  debug: false  // Set to true for development debugging
});

// Enable immediate activation and control
self.skipWaiting();
workbox.core.clientsClaim();

// Enable navigation preload for faster page loads
workbox.navigationPreload.enable();

const { StaleWhileRevalidate, CacheFirst, NetworkFirst } = workbox.strategies;
const { precacheAndRoute } = workbox.precaching;
const { ExpirationPlugin } = workbox.expiration;
const { CacheableResponsePlugin } = workbox.cacheableResponse;

// Cache version - increment this to force cache refresh
const CACHE_VERSION = 'v2';

// Precache critical assets for instant offline experience
// These load on first visit for optimal Core Web Vitals
precacheAndRoute([
  { url: '/', revision: CACHE_VERSION },                    // Homepage (instant repeat visits)
  { url: '/offline/index.html', revision: CACHE_VERSION },  // Offline fallback
  { url: '/manifest.json', revision: CACHE_VERSION },       // PWA manifest
  { url: '/site.webmanifest', revision: CACHE_VERSION }     // Alternative manifest
]);

// ============================================================================
// 1. HTML/Document Pages - Stale-While-Revalidate Strategy
// ============================================================================
// Instant load from cache while fetching fresh content in background
// This is OPTIMAL for both performance (instant) and SEO (always fresh)
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'document',
  new StaleWhileRevalidate({
    cacheName: `pages-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 150,
        maxAgeSeconds: 60 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ============================================================================
// 2. CSS Stylesheets - Stale-While-Revalidate
// ============================================================================
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'style',
  new StaleWhileRevalidate({
    cacheName: `css-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 150,
        maxAgeSeconds: 180 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ============================================================================
// 3. JavaScript - Stale-While-Revalidate
// ============================================================================
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'script',
  new StaleWhileRevalidate({
    cacheName: `js-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 150,
        maxAgeSeconds: 180 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ============================================================================
// 4. Images - Stale-While-Revalidate for freshness
// ============================================================================
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: `image-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 800,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ============================================================================
// 5. Web Fonts - Cache-First (fonts never change)
// ============================================================================
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: `font-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ============================================================================
// 6. Audio/Video - Cache-First with Range Request Support
// ============================================================================
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'audio' || request.destination === 'video',
  new CacheFirst({
    cacheName: `media-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200, 206]
      }),
      new workbox.rangeRequests.RangeRequestsPlugin(),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 90 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ============================================================================
// 7. Google Fonts - Cache-First (static CDN resources)
// ============================================================================
workbox.routing.registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com' ||
              url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: `google-fonts-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ============================================================================
// 8. CDN Resources - Stale-While-Revalidate
// ============================================================================
workbox.routing.registerRoute(
  ({ url }) => url.origin === 'https://cdn.jsdelivr.net' ||
              url.origin === 'https://cdnjs.cloudflare.com' ||
              url.origin === 'https://unpkg.com' ||
              url.origin === 'https://storage.googleapis.com',
  new StaleWhileRevalidate({
    cacheName: `cdn-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ============================================================================
// 9. API Requests - Network-First with Short Cache
// ============================================================================
workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: `api-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 150,
        maxAgeSeconds: 10 * 60,
        purgeOnQuotaError: true
      })
    ],
    networkTimeoutSeconds: 5
  })
);

// ============================================================================
// 10. Catch-All for Same-Origin Requests
// ============================================================================
workbox.routing.registerRoute(
  ({ url, request }) => url.origin === self.location.origin &&
                        !request.destination,
  new StaleWhileRevalidate({
    cacheName: `misc-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 60 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ============================================================================
// Offline Fallback Handler
// ============================================================================
workbox.routing.setCatchHandler(async ({ event }) => {
  switch (event.request.destination) {
    case 'document':
      return caches.match('/offline/index.html') ||
             caches.match('/') ||
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

// ============================================================================
// Message Handler - Manual Cache Control
// ============================================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(`runtime-cache-${CACHE_VERSION}`).then((cache) => {
        return cache.addAll(event.data.payload);
      })
    );
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      })
    );
  }
});

// ============================================================================
// Activation - Clean Up Old Caches
// ============================================================================
self.addEventListener('activate', (event) => {
  console.log('Service Worker activated with version:', CACHE_VERSION);

  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              return (cacheName.includes('-cache-') ||
                      cacheName === 'my-cache' ||
                      cacheName === 'image-cache' ||
                      cacheName === 'runtime-cache') &&
                     !cacheName.endsWith(CACHE_VERSION);
            })
            .map((cacheName) => {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      }),
      self.clients.claim()
    ])
  );
});

// ============================================================================
// Installation - Pre-cache Critical Assets
// ============================================================================
self.addEventListener('install', (event) => {
  console.log('Service Worker installing with version:', CACHE_VERSION);

  event.waitUntil(
    caches.open(`precache-${CACHE_VERSION}`).then((cache) => {
      return cache.addAll([
        '/',
        '/offline/index.html',
        '/manifest.json'
      ]).catch((error) => {
        console.warn('Pre-cache failed for some resources:', error);
      });
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

console.log('Service Worker loaded with Workbox 7.3.0 - Optimized for Performance & SEO');
