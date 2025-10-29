// Service Worker with Workbox 6.4.1 - Aggressive caching with auto-updates
importScripts(
  'https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js'
);

// Enable immediate activation and control
self.skipWaiting();
workbox.core.clientsClaim();

// Enable navigation preload for faster page loads
workbox.navigationPreload.enable();

const { StaleWhileRevalidate, CacheFirst, NetworkFirst } = workbox.strategies;
const { precacheAndRoute } = workbox.precaching;
const { ExpirationPlugin } = workbox.expiration;
const { CacheableResponsePlugin } = workbox.cacheableResponse;
const { BroadcastUpdatePlugin } = workbox.broadcastUpdate;

// Cache version - increment this to force cache refresh
const CACHE_VERSION = 'v1';

// Precache critical offline pages
precacheAndRoute([
  { url: '/offline/index.html', revision: CACHE_VERSION },
  { url: '/manifest.json', revision: CACHE_VERSION }
]);

// 1. HTML/Document pages - Stale While Revalidate (cache first, update in background)
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'document',
  new StaleWhileRevalidate({
    cacheName: `pages-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 100, // Increased from 50
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        purgeOnQuotaError: true
      }),
      // Notify when page updates are available
      new BroadcastUpdatePlugin({
        headersToCheck: ['content-length', 'etag', 'last-modified']
      })
    ]
  })
);

// 2. CSS/Stylesheets - Stale while revalidate
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'style',
  new StaleWhileRevalidate({
    cacheName: `css-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 100, // Increased
        maxAgeSeconds: 90 * 24 * 60 * 60, // 90 days
        purgeOnQuotaError: true
      })
    ]
  })
);

// 3. JavaScript - Stale while revalidate
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'script',
  new StaleWhileRevalidate({
    cacheName: `js-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 100, // Increased
        maxAgeSeconds: 90 * 24 * 60 * 60, // 90 days
        purgeOnQuotaError: true
      })
    ]
  })
);

// 4. Images - Stale while revalidate (was CacheFirst, now updates)
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: `image-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 500, // Increased for more images
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        purgeOnQuotaError: true
      })
    ]
  })
);

// 5. Fonts - Cache first (fonts rarely change)
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: `font-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        purgeOnQuotaError: true
      })
    ]
  })
);

// 6. Audio/Video - Range request support with cache
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'audio' || request.destination === 'video',
  new CacheFirst({
    cacheName: `media-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200, 206] // Include partial content
      }),
      new workbox.rangeRequests.RangeRequestsPlugin(),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        purgeOnQuotaError: true
      })
    ]
  })
);

// 7. Google Fonts - Cache first
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
        maxEntries: 50,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// 8. CDN resources - Stale while revalidate
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
        maxEntries: 200, // Increased
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        purgeOnQuotaError: true
      })
    ]
  })
);

// 9. API requests - Network first with cache fallback
workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: `api-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 10 * 60, // 10 minutes
        purgeOnQuotaError: true
      })
    ],
    networkTimeoutSeconds: 5
  })
);

// 10. Catch-all for same-origin requests - Stale while revalidate
workbox.routing.registerRoute(
  ({ url, request }) => url.origin === self.location.origin &&
                        !request.destination, // No specific destination
  new StaleWhileRevalidate({
    cacheName: `misc-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// Offline fallback handler
workbox.routing.setCatchHandler(async ({ event }) => {
  switch (event.request.destination) {
    case 'document':
      return caches.match('/offline/index.html') || 
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

// Listen for messages from the page
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_URLS') {
    // Manually cache specific URLs
    event.waitUntil(
      caches.open(`runtime-cache-${CACHE_VERSION}`).then((cache) => {
        return cache.addAll(event.data.payload);
      })
    );
  }
});

// Clean up old caches on activation
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all([
        // Delete old versioned caches
        ...cacheNames
          .filter((cacheName) => {
            return (cacheName.includes('-cache-') || 
                    cacheName === 'my-cache' || 
                    cacheName === 'image-cache') &&
                   !cacheName.endsWith(CACHE_VERSION);
          })
          .map((cacheName) => {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }),
        // Claim clients immediately
        self.clients.claim()
      ]);
    })
  );
});

// Install event - pre-cache critical assets
self.addEventListener('install', (event) => {
  console.log('Service Worker installing with version:', CACHE_VERSION);
  // Force waiting service worker to become active
  self.skipWaiting();
});

// Log when service worker is activated
self.addEventListener('activate', (event) => {
  console.log('Service Worker activated with version:', CACHE_VERSION);
});

console.log('Service Worker loaded with Workbox 6.4.1 - Aggressive caching enabled');
