// Service Worker with Workbox 7.3.0 — Instant loading + Comprehensive caching + instant.page compatibility

importScripts('/workbox/workbox-sw.js');

// Configure Workbox to use local files instead of CDN
workbox.setConfig({ 
  modulePathPrefix: '/workbox/', 
  debug: false 
});

// Immediate activation and control for instant takeover
self.skipWaiting();
workbox.core.clientsClaim();

// ----- Define modules and constants -----
const { StaleWhileRevalidate, CacheFirst, NetworkFirst } = workbox.strategies;
const { precacheAndRoute, getCacheKeyForURL } = workbox.precaching;
const { ExpirationPlugin } = workbox.expiration;
const { CacheableResponsePlugin } = workbox.cacheableResponse;
const CACHE_VERSION = 'v4-instant';

// Offline page detection
const OFFLINE_PAGE_URLS = [
  '/offline/',
  '/offline/index.html',
  '/offline'
];

function isOfflinePageByURL(url) {
  const urlString = typeof url === 'string' ? url : url.href || url.url || '';
  return OFFLINE_PAGE_URLS.some(offlineUrl => 
    urlString.includes(offlineUrl) || 
    new URL(urlString, self.location.origin).pathname === offlineUrl
  );
}

async function isOfflinePageByContent(response) {
  if (!response) return false;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return false;
  
  try {
    const text = await response.clone().text();
    return text.includes('id="offline-page"') || 
           text.includes('You\'re offline') ||
           text.includes('offline-page');
  } catch (e) {
    return false;
  }
}

async function isOfflinePage(response) {
  if (!response) return false;
  if (isOfflinePageByURL(response.url)) return true;
  return await isOfflinePageByContent(response);
}

async function serveOfflinePage() {
  const offlineResponse = await workbox.precaching.matchPrecache('/offline/index.html') ||
                         await caches.match('/offline/index.html') ||
                         await caches.match(getCacheKeyForURL('/offline/index.html'));
  
  if (offlineResponse) {
    const headers = new Headers(offlineResponse.headers);
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    headers.set('Expires', '0');
    headers.set('X-Offline-Fallback', '1');
    
    return new Response(offlineResponse.body, {
      status: offlineResponse.status,
      statusText: offlineResponse.statusText,
      headers: headers
    });
  }
  
  return new Response(
    '<html><body><h1>Offline</h1><p>Please check your internet connection.</p></body></html>',
    { 
      status: 503,
      headers: { 
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    }
  );
}

// ----- Precache critical assets -----
precacheAndRoute([
  { url: '/offline/index.html', revision: CACHE_VERSION },
  { url: '/manifest.json', revision: CACHE_VERSION },
  { url: '/site.webmanifest', revision: CACHE_VERSION }
]);

// ----- Enable Navigation Preload for faster initial loads -----
workbox.navigationPreload.enable();

// ----- Instant Navigation Strategy with intelligent caching -----
workbox.routing.registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !isOfflinePageByURL(url),
  async ({ event, request }) => {
    const cache = await caches.open(`pages-${CACHE_VERSION}`);
    
    // Try cache first for instant loading
    const cached = await cache.match(request);
    if (cached && !(await isOfflinePage(cached))) {
      // Background update - don't wait for it
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(request);
          if (fresh && fresh.ok && fresh.status === 200 && !(await isOfflinePage(fresh))) {
            await cache.put(request, fresh.clone());
          }
        } catch (e) {
          // Silent fail - we have cached version
        }
      })());
      return cached; // Instant response from cache
    }

    // Not in cache or cached version is offline page - try network
    try {
      const response = await fetch(request);
      if (response && response.status === 200 && !(await isOfflinePage(response))) {
        // Cache successful responses for future instant loads
        event.waitUntil(cache.put(request, response.clone()));
      }
      return response; // Return actual response (even 404/500)
    } catch (error) {
      // Network completely failed - serve offline page
      return serveOfflinePage();
    }
  }
);

// ----- Instant.page compatibility: Capture and cache prefetched pages -----
workbox.routing.registerRoute(
  ({ url, request }) => {
    // Match instant.page prefetch requests
    const isSameOrigin = url.origin === self.location.origin;
    const isGET = request.method === 'GET';
    const isPrefetchHeader =
      request.headers.get('Sec-Purpose') === 'prefetch' ||
      request.headers.get('Purpose') === 'prefetch' ||
      request.headers.get('X-Purpose') === 'prefetch';
    const isInstantPage = request.headers.get('X-Instant-Page') === 'true';
    const acceptsHTML = (request.headers.get('Accept') || '').includes('text/html');
    
    return isSameOrigin && isGET && acceptsHTML && 
           (isPrefetchHeader || isInstantPage) && 
           !isOfflinePageByURL(url);
  },
  async ({ event, request }) => {
    try {
      const response = await fetch(request);
      if (response && response.ok && response.status === 200 && !(await isOfflinePage(response))) {
        // Store prefetched pages for instant navigation
        event.waitUntil((async () => {
          const cache = await caches.open(`pages-${CACHE_VERSION}`);
          await cache.put(request, response.clone());
        })());
      }
      return response;
    } catch (e) {
      return Response.error();
    }
  }
);

// ----- CSS — Stale-While-Revalidate (1 year cache) -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'style',
  new StaleWhileRevalidate({
    cacheName: `css-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- JavaScript — Stale-While-Revalidate (1 year cache) -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'script',
  new StaleWhileRevalidate({
    cacheName: `js-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Images — Cache-First (1 year cache) -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: `images-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 500,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Fonts — Cache-First (1 year cache) -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: `fonts-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Media (Audio/Video) — Cache-First + Range Support -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'audio' || request.destination === 'video',
  new CacheFirst({
    cacheName: `media-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200, 206] }),
      new workbox.rangeRequests.RangeRequestsPlugin(),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 90 * 24 * 60 * 60, // 90 days
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Google Fonts — Cache-First (1 year) -----
workbox.routing.registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com' ||
               url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: `google-fonts-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- CDNs — Stale-While-Revalidate (1 year cache) -----
workbox.routing.registerRoute(
  ({ url }) =>
    url.origin === 'https://cdn.jsdelivr.net' ||
    url.origin === 'https://cdnjs.cloudflare.com' ||
    url.origin === 'https://unpkg.com' ||
    url.origin === 'https://storage.googleapis.com' ||
    url.origin === 'https://ajax.googleapis.com',
  new StaleWhileRevalidate({
    cacheName: `cdns-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- JSON/Data — Network First (5 minute cache) -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'json' || 
                  request.headers.get('Accept')?.includes('application/json'),
  new NetworkFirst({
    cacheName: `data-${CACHE_VERSION}`,
    networkTimeoutSeconds: 3,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 5 * 60, // 5 minutes
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- API — Network First (2 minute cache) -----
workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: `api-${CACHE_VERSION}`,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 2 * 60, // 2 minutes
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Everything else — Stale-While-Revalidate (30 day cache) -----
workbox.routing.registerRoute(
  ({ url }) => url.origin === self.location.origin,
  new StaleWhileRevalidate({
    cacheName: `misc-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ----- Offline fallback -----
workbox.routing.setCatchHandler(async ({ event }) => {
  if (event.request.destination === 'document' || event.request.mode === 'navigate') {
    return serveOfflinePage();
  }
  
  if (event.request.destination === 'image') {
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="#f0f0f0" width="200" height="200"/><text x="50%" y="50%" font-family="Arial,sans-serif" font-size="14" text-anchor="middle" dy=".3em" fill="#999">Offline</text></svg>',
      { 
        headers: { 
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
        } 
      }
    );
  }
  
  return Response.error();
});

// ----- Messaging system for cache control -----
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();

  // Precache specific URLs from the main thread
  if (event.data?.type === 'PRECACHE_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(`pages-${CACHE_VERSION}`);
      for (const url of event.data.urls) {
        if (!isOfflinePageByURL(url)) {
          try {
            const response = await fetch(url);
            if (response.ok && !(await isOfflinePage(response))) {
              await cache.put(url, response);
            }
          } catch (_) {}
        }
      }
    })());
  }

  // Clear all caches
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(keys => 
      Promise.all(keys.map(key => caches.delete(key)))
    ));
  }
});

// ----- Activation and cleanup -----
self.addEventListener('activate', (event) => {
  console.log('Service Worker activated with version:', CACHE_VERSION);
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean up old caches
      caches.keys().then(keys => 
        Promise.all(keys.map(key => {
          if (key !== `pages-${CACHE_VERSION}` && 
              key !== `css-${CACHE_VERSION}` && 
              key !== `js-${CACHE_VERSION}` &&
              key !== `images-${CACHE_VERSION}` &&
              key !== `fonts-${CACHE_VERSION}` &&
              key !== `media-${CACHE_VERSION}` &&
              key !== `google-fonts-${CACHE_VERSION}` &&
              key !== `cdns-${CACHE_VERSION}` &&
              key !== `data-${CACHE_VERSION}` &&
              key !== `api-${CACHE_VERSION}` &&
              key !== `misc-${CACHE_VERSION}`) {
            console.log('Deleting old cache:', key);
            return caches.delete(key);
          }
        }))
      ),
      // Clean any offline pages from page cache
      (async () => {
        const cache = await caches.open(`pages-${CACHE_VERSION}`);
        const keys = await cache.keys();
        for (const request of keys) {
          const response = await cache.match(request);
          if (response && (await isOfflinePage(response))) {
            await cache.delete(request);
            console.log('Cleaned offline page from cache:', request.url);
          }
        }
      })()
    ])
  );
});

console.log('Service Worker loaded — Instant loading + Comprehensive caching + instant.page compatible');