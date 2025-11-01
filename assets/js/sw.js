// Service Worker with Workbox 7.3.0 (Local) — Instant navigations + fast revalidation + prefetch capture

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
const CACHE_VERSION = 'v3';

// Superior offline page detection with multiple fallbacks
const OFFLINE_PAGE_URLS = [
  '/offline/',
  '/offline/index.html',
  '/offline'
];

// Cache for offline page detection results to avoid repeated content parsing
const offlineDetectionCache = new Map();

function isOfflinePageByURL(url) {
  const urlString = typeof url === 'string' ? url : url.href || url.url || '';
  return OFFLINE_PAGE_URLS.some(offlineUrl => 
    urlString.includes(offlineUrl) || 
    new URL(urlString, self.location.origin).pathname === offlineUrl
  );
}

async function isOfflinePageByContent(response) {
  if (!response) return false;
  
  // Check cache first for performance
  const cacheKey = response.url;
  if (offlineDetectionCache.has(cacheKey)) {
    return offlineDetectionCache.get(cacheKey);
  }
  
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    offlineDetectionCache.set(cacheKey, false);
    return false;
  }
  
  try {
    // Clone response to avoid consuming the body
    const text = await response.clone().text();
    // Multiple content markers for maximum reliability
    const isOffline = text.includes('id="offline-page"') || 
                     text.includes('You\'re offline') ||
                     text.includes('offline-page');
    
    // Cache the result for this URL (short TTL)
    offlineDetectionCache.set(cacheKey, isOffline);
    setTimeout(() => offlineDetectionCache.delete(cacheKey), 30000); // Clear after 30s
    
    return isOffline;
  } catch (e) {
    offlineDetectionCache.set(cacheKey, false);
    return false;
  }
}

// Superior offline page detection - tries URL first, then content as fallback
async function isOfflinePage(response) {
  if (!response) return false;
  
  // Fast path: URL-based detection
  if (isOfflinePageByURL(response.url)) {
    return true;
  }
  
  // Fallback: Content-based detection for cases where offline page was cached under wrong URL
  return await isOfflinePageByContent(response);
}

// Helper function to serve offline page with proper headers
async function serveOfflinePage() {
  const offlineResponse = await workbox.precaching.matchPrecache('/offline/index.html') ||
                         await caches.match('/offline/index.html') ||
                         await caches.match(getCacheKeyForURL('/offline/index.html'));
  
  if (offlineResponse) {
    // Clone and add no-cache headers to prevent caching the offline response
    const headers = new Headers(offlineResponse.headers);
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    headers.set('Expires', '0');
    headers.set('X-Offline-Fallback', '1'); // Add custom header for easy detection
    
    return new Response(offlineResponse.body, {
      status: offlineResponse.status,
      statusText: offlineResponse.statusText,
      headers: headers
    });
  }
  
  // Ultimate fallback - this should rarely happen since we precache offline page
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

// ----- Precache critical assets early (served cache-first by precaching) -----
precacheAndRoute([
  { url: '/offline/index.html', revision: CACHE_VERSION },  // Offline fallback
  { url: '/manifest.json', revision: CACHE_VERSION },       // PWA manifest
  { url: '/site.webmanifest', revision: CACHE_VERSION }     // Alternative manifest
]);

// ----- Enable Navigation Preload for navigations -----
workbox.navigationPreload.enable();

// CRITICAL: Route ordering matters - specific routes first, generic last
// Register specific routes for problematic pages to ensure they get proper handling
const specialPaths = new Set([
  '/about', '/about/', 
  '/contact', '/contact/', 
  '/disclaimer', '/disclaimer/', 
  '/privacy', '/privacy/', 
  '/feed', '/feed/', 
  '/offline', '/offline/'
]);

workbox.routing.registerRoute(
  ({ url }) => specialPaths.has(url.pathname),
  async ({ event, request, url }) => {
    console.log('Specific route handling for:', url.pathname);
    const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
    
    // For these specific pages, always try network first
    try {
      const preloadPromise = event.preloadResponse;
      const networkPromise = fetch(request);
      const response = (await preloadPromise) || (await networkPromise);
      
      if (response) {
        // Cache successful responses that aren't offline pages
        if (response.ok && response.status === 200 && !(await isOfflinePage(response))) {
          event.waitUntil(cache.put(request, response.clone()));
        }
        // Return the response as-is, even if it's a 404/500
        return response;
      }
    } catch (error) {
      console.log('Network failed for specific page:', url.pathname, error);
      // Fall through to cache/offline handling
    }
    
    // Fallback to cache if available and not offline page
    const cached = await cache.match(request);
    if (cached && !(await isOfflinePage(cached))) {
      return cached;
    }
    
    // Final fallback to offline page - only for actual network failures
    return serveOfflinePage();
  },
  'GET'
);

// ----- Main Navigations: instant cache + background update via preload -----
workbox.routing.registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !isOfflinePageByURL(url),
  async ({ event, request }) => {
    const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
    const cached = await cache.match(request);

    // Preload nav response if available, else fall back to network
    const preloadPromise = event.preloadResponse;
    const networkPromise = fetch(request);

    if (cached) {
      // Superior offline page detection
      const isCachedOfflinePage = await isOfflinePage(cached);

      // If cached response is offline page, try to fetch fresh
      if (isCachedOfflinePage) {
        console.log('Found cached offline page, attempting fresh fetch:', request.url);
        try {
          const fresh = (await preloadPromise) || (await networkPromise);
          if (fresh) {
            // Only cache if it's not an offline page and is successful
            if (fresh.ok && fresh.status === 200 && !(await isOfflinePage(fresh))) {
              await cache.put(request, fresh.clone());
            }
            return fresh; // Return the fresh response (even 404/500)
          }
        } catch (error) {
          // If network fails, still return the cached offline page
          return cached;
        }
      } else {
        // Return cached response and update in background
        event.waitUntil((async () => {
          try {
            const fresh = (await preloadPromise) || (await networkPromise);
            if (fresh && fresh.ok && fresh.status === 200) {
              // Only update cache if we get a valid non-offline response
              if (!(await isOfflinePage(fresh))) {
                await cache.put(request, fresh.clone());
              }
            }
          } catch (e) {
            // Network failed during background revalidation, keep using cache
            console.log('Background update failed for:', request.url, e);
          }
        })());
        return cached;
      }
    }

    // First visit or cache miss: try network first
    try {
      const response = (await preloadPromise) || (await networkPromise);
      
      // Always return the actual response, even if 404/500
      if (response) {
        // Only cache successful responses that aren't offline pages
        if (response.ok && response.status === 200 && !(await isOfflinePage(response))) {
          event.waitUntil(cache.put(request, response.clone()));
        }
        return response; // Don't force offline for HTTP errors
      }
      throw new Error('No response received'); // Will trigger offline fallback
    } catch (error) {
      console.log('Network failed, serving offline page for:', request.url);
      // Only reach here on actual network failure => serve offline fallback
      return serveOfflinePage();
    }
  },
  'GET'
);

// ----- Capture <link rel=prefetch> navigation prefetches and persist to pages cache -----
workbox.routing.registerRoute(
  ({ url, request }) => {
    // Same-origin GET prefetches signaled by Purpose/Sec-Purpose: prefetch and empty destination
    const isSameOrigin = url.origin === self.location.origin;
    const isGET = request.method === 'GET';
    const isPrefetchHeader =
      request.headers.get('Sec-Purpose') === 'prefetch' ||
      request.headers.get('Purpose') === 'prefetch';
    const isLowPriority = request.priority === 'low'; // Additional signal for prefetch
    const acceptsHTML = (request.headers.get('Accept') || '').includes('text/html');
    
    return isSameOrigin && isGET && acceptsHTML && (isPrefetchHeader || isLowPriority) && !isOfflinePageByURL(url);
  },
  async ({ event, request }) => {
    // Pass through response but also persist it for instant future navigations
    try {
      const response = await fetch(request);
      if (response && response.ok && response.status === 200) {
        // Verify it's not the offline page before caching
        if (!(await isOfflinePage(response))) {
          event.waitUntil((async () => {
            const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
            await cache.put(request, response.clone());
          })());
        }
      }
      return response;
    } catch (e) {
      return fetch(request);
    }
  },
  'GET'
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
  ({ url, request }) => url.origin === self.location.origin && !request.destination && !isOfflinePageByURL(url),
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
  // Handle navigation requests (document pages)
  if (event.request.destination === 'document' || event.request.mode === 'navigate') {
    return serveOfflinePage();
  }
  
  // Handle images with a placeholder SVG
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
  
  // For all other requests, return error
  return Response.error();
});

// ----- Messaging: manual cache control + bulk prefetch hook -----
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();

  if (event.data?.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(`runtime-cache-${CACHE_VERSION}`).then((cache) => 
        cache.addAll(event.data.payload.filter(url => !isOfflinePageByURL(url)))
      )
    );
  }

  if (event.data?.type === 'PREFETCH_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
      await Promise.all(event.data.urls
        .filter(url => !isOfflinePageByURL(url))
        .map(async (u) => {
          try {
            const res = await fetch(u, { credentials: 'same-origin' });
            if (res && res.ok && !(await isOfflinePage(res))) {
              await cache.put(u, res.clone());
            }
          } catch (_) {}
        })
      );
    })());
  }

  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }
  
  // Enhanced: Clear offline pages from cache with superior detection
  if (event.data?.type === 'CLEAR_BAD_CACHE') {
    event.waitUntil((async () => {
      const cacheNames = await caches.keys();
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        for (const request of keys) {
          const response = await cache.match(request);
          if (response && (await isOfflinePage(response))) {
            await cache.delete(request);
            console.log('Cleared offline page from cache:', cacheName, request.url);
          }
        }
      }
    })());
  }
});

// ----- Activation: claim clients + comprehensive cleanup -----
self.addEventListener('activate', (event) => {
  console.log('Service Worker activated with version:', CACHE_VERSION);
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Comprehensive cleanup across all caches
      (async () => {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          const cache = await caches.open(cacheName);
          const keys = await cache.keys();
          for (const request of keys) {
            const response = await cache.match(request);
            if (response && (await isOfflinePage(response))) {
              await cache.delete(request);
              console.log('Cleaned offline page from cache on activation:', cacheName, request.url);
            }
          }
        }
      })()
    ])
  );
});

console.log('Service Worker loaded — Enhanced offline detection + Route prioritization');