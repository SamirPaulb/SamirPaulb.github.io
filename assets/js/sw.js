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

// ----- Precache critical assets early (served cache-first by precaching) -----
precacheAndRoute([
  { url: '/offline/index.html', revision: CACHE_VERSION },  // Offline fallback
  { url: '/manifest.json', revision: CACHE_VERSION },       // PWA manifest
  { url: '/site.webmanifest', revision: CACHE_VERSION }     // Alternative manifest
]); // Precached URLs get deterministic cache-first responses and versioning control

// ----- Enable Navigation Preload for navigations -----
workbox.navigationPreload.enable(); // Provides event.preloadResponse for navigations to speed up revalidation

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
      // Better offline page detection - check response URL and specific ID
      const responseUrl = cached.url;
      const contentType = cached.headers.get('content-type') || '';
      
      // More reliable offline page detection
      let isLikelyOfflinePage = responseUrl.includes('/offline/');
      
      // Check for the specific offline page ID in HTML content
      if (contentType.includes('text/html') && !isLikelyOfflinePage) {
        try {
          const text = await cached.clone().text();
          isLikelyOfflinePage = text.includes('id="offline-page"');
        } catch (e) {
          // If we can't read the text, assume it's not an offline page
          isLikelyOfflinePage = false;
        }
      }

      // If cached response is offline page AND we're online, fetch fresh
      if (isLikelyOfflinePage && navigator.onLine) {
        console.log('Found cached offline page while online, fetching fresh:', request.url);
        try {
          const fresh = (await preloadPromise) || (await networkPromise);
          if (fresh && fresh.ok) {
            await cache.put(request, fresh.clone());
            return fresh;
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
              const freshUrl = fresh.url;
              const freshContentType = fresh.headers.get('content-type') || '';
              
              let isFreshOfflinePage = freshUrl.includes('/offline/');
              if (freshContentType.includes('text/html') && !isFreshOfflinePage) {
                try {
                  const freshText = await fresh.clone().text();
                  isFreshOfflinePage = freshText.includes('id="offline-page"');
                } catch (e) {
                  isFreshOfflinePage = false;
                }
              }
              
              if (!isFreshOfflinePage) {
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
      if (response && response.ok) {
        // Only cache if it's not an offline page
        const responseUrl = response.url;
        const responseContentType = response.headers.get('content-type') || '';
        
        let isResponseOfflinePage = responseUrl.includes('/offline/');
        if (responseContentType.includes('text/html') && !isResponseOfflinePage) {
          try {
            const responseText = await response.clone().text();
            isResponseOfflinePage = responseText.includes('id="offline-page"');
          } catch (e) {
            isResponseOfflinePage = false;
          }
        }
        
        if (!isResponseOfflinePage) {
          event.waitUntil(cache.put(request, response.clone()));
        }
        return response;
      }
      throw new Error(`Network response not ok: ${response?.status}`);
    } catch (error) {
      console.log('Network failed, serving offline page for:', request.url);
      // Network failed - serve offline page but DON'T cache this response
      const offlineResponse = await caches.match('/offline/index.html') || 
                             await caches.match(getCacheKeyForURL('/offline/index.html'));
      
      if (offlineResponse) {
        return offlineResponse;
      }
      
      // Ultimate fallback
      return new Response('Offline - No cached version available', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
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
    
    return isSameOrigin && isGET && acceptsHTML && (isPrefetchHeader || isLowPriority);
  },
  async ({ event, request }) => {
    // Pass through response but also persist it for instant future navigations
    try {
      const response = await fetch(request); // Low-priority prefetch stays off the main path
      if (response && response.ok && response.status === 200) {
        // Verify it's not the offline page before caching
        const responseUrl = response.url;
        const responseContentType = response.headers.get('content-type') || '';
        
        let isOfflinePage = responseUrl.includes('/offline/');
        if (responseContentType.includes('text/html') && !isOfflinePage) {
          try {
            const responseText = await response.clone().text();
            isOfflinePage = responseText.includes('id="offline-page"');
          } catch (e) {
            isOfflinePage = false;
          }
        }
        
        if (!isOfflinePage) {
          event.waitUntil((async () => {
            const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
            await cache.put(request, response.clone());
          })());
        }
      }
      return response;
    } catch (e) {
      // Prefetch failed, return the error
      return fetch(request);
    }
  }
); // Extends lifetime of browser prefetches by storing in SW cache

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
  // Handle navigation requests (document pages)
  if (event.request.destination === 'document' || event.request.mode === 'navigate') {
    // Try to return the precached offline page with proper no-cache headers
    const offlineResponse = (await caches.match('/offline/index.html')) ||
                           (await caches.match(getCacheKeyForURL('/offline/index.html')));
    
    if (offlineResponse) {
      // Clone and add no-cache headers to prevent caching the offline response
      const headers = new Headers(offlineResponse.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      headers.set('Expires', '0');
      
      return new Response(offlineResponse.body, {
        status: offlineResponse.status,
        statusText: offlineResponse.statusText,
        headers: headers
      });
    }
    
    // Fallback plain text response with strict no-cache headers
    return new Response('Offline - No cached version available', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    }); // Graceful offline handling for documents
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
      caches.open(`runtime-cache-${CACHE_VERSION}`).then((cache) => cache.addAll(event.data.payload))
    );
  }

  if (event.data?.type === 'PREFETCH_URLS' && Array.isArray(event.data.urls)) {
    // Optional: window -> SW prefetch channel to warm caches in background
    event.waitUntil((async () => {
      const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
      await Promise.all(event.data.urls.map(async (u) => {
        try {
          const res = await fetch(u, { credentials: 'same-origin' });
          if (res && res.ok) {
            // Check if it's not an offline page before caching
            const resUrl = res.url;
            const resContentType = res.headers.get('content-type') || '';
            
            let isOfflinePage = resUrl.includes('/offline/');
            if (resContentType.includes('text/html') && !isOfflinePage) {
              try {
                const resText = await res.clone().text();
                isOfflinePage = resText.includes('id="offline-page"');
              } catch (e) {
                isOfflinePage = false;
              }
            }
            
            if (!isOfflinePage) {
              await cache.put(u, res.clone());
            }
          }
        } catch (_) {}
      }));
    })()); // Background-only; doesn't block UI
  }

  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }
  
  // New: Clear specific bad cached entries
  if (event.data?.type === 'CLEAR_BAD_CACHE') {
    event.waitUntil((async () => {
      const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
      const keys = await cache.keys();
      for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
          const responseUrl = response.url;
          // Only remove if URL explicitly points to offline page
          if (responseUrl.includes('/offline/')) {
            await cache.delete(request);
            console.log('Cleared bad cached entry:', request.url);
          } else {
            // Also check content for offline page marker
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/html')) {
              try {
                const text = await response.text();
                if (text.includes('id="offline-page"')) {
                  await cache.delete(request);
                  console.log('Cleared offline page from cache:', request.url);
                }
              } catch (e) {
                // Skip if we can't read the content
              }
            }
          }
        }
      }
    })());
  }
});

// ----- Activation: claim clients only (ExpirationPlugin handles expiration) -----
self.addEventListener('activate', (event) => {
  console.log('Service Worker activated with version:', CACHE_VERSION);
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Conservative cleanup - only remove obvious offline pages
      (async () => {
        const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
        const keys = await cache.keys();
        for (const request of keys) {
          const response = await cache.match(request);
          if (response) {
            const responseUrl = response.url;
            // Only remove if URL explicitly points to offline page
            if (responseUrl.includes('/offline/')) {
              await cache.delete(request);
              console.log('Cleaned offline page from cache on activation:', request.url);
            } else {
              // Also check content for offline page marker
              const contentType = response.headers.get('content-type') || '';
              if (contentType.includes('text/html')) {
                try {
                  const text = await response.text();
                  if (text.includes('id="offline-page"')) {
                    await cache.delete(request);
                    console.log('Cleaned offline page from cache on activation:', request.url);
                  }
                } catch (e) {
                  // Skip if we can't read the content
                }
              }
            }
          }
        }
      })()
    ])
  );
});

console.log('Service Worker loaded — Instant navigations + fast revalidation + prefetch capture');