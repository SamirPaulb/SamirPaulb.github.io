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

// Offline page URL variants (normalized)
const OFFLINE_PATHS = ['/offline', '/offline/index.html'];

// Content marker inside the offline HTML
const OFFLINE_CONTENT_MARKER = 'id="offline-page"';

// Normalize a URL/pathname (remove trailing slash except for root)
const normalizePath = (pathOrUrl) => {
  const pathname = new URL(pathOrUrl, self.location.origin).pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
};

const OFFLINE_NORMALIZED = new Set(OFFLINE_PATHS.map(normalizePath));

const isOfflinePath = (urlLike) => OFFLINE_NORMALIZED.has(normalizePath(urlLike));

// Header sentinel to tag offline fallback responses
const OFFLINE_HEADER = 'X-Offline-Fallback';

// Quick header-based offline detection
const isOfflineByHeader = (res) => res && res.headers && res.headers.get(OFFLINE_HEADER) === '1';

// URL-based offline detection for the response (only if it came from the offline URL itself)
const isOfflineByResponseURL = (res) => {
  if (!res || !res.url) return false;
  try {
    return isOfflinePath(res.url);
  } catch {
    return false;
  }
};

// Content-based offline detection (checks for a known marker in HTML)
const looksLikeOfflineHTML = async (res) => {
  try {
    if (!res) return false;
    const ct = res.headers.get('Content-Type') || '';
    if (!ct.includes('text/html')) return false;
    const text = await res.clone().text();
    return text.includes(OFFLINE_CONTENT_MARKER);
  } catch {
    return false;
  }
};

// Combined robust offline detection
const isOfflinePageResponse = async (res) => {
  if (!res) return false;
  if (isOfflineByHeader(res)) return true;
  if (isOfflineByResponseURL(res)) return true;
  return looksLikeOfflineHTML(res);
};

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
  ({ request, url }) => request.mode === 'navigate' && !isOfflinePath(url),
  async ({ event, request }) => {
    const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
    const cached = await cache.match(request);

    // Preload nav response if available, else fall back to network
    const preloadPromise = event.preloadResponse; // Promise<Response|null>
    const networkPromise = fetch(request);        // Parallel fallback for when preload is null

    if (cached) {
      // If the cached response is actually the offline page and we're online, fetch fresh now
      let cachedIsOffline = isOfflineByHeader(cached) || isOfflineByResponseURL(cached);
      if (!cachedIsOffline) {
        // Only do the content check if needed and it's HTML
        const ct = cached.headers.get('Content-Type') || '';
        if (ct.includes('text/html')) {
          try { cachedIsOffline = await looksLikeOfflineHTML(cached); } catch {}
        }
      }

      if (cachedIsOffline && navigator.onLine) {
        try {
          const fresh = (await preloadPromise) || (await networkPromise);
          if (fresh && fresh.ok) {
            // Avoid storing offline fallback content as a page
            const freshIsOffline = isOfflineByHeader(fresh) || isOfflineByResponseURL(fresh) || await looksLikeOfflineHTML(fresh);
            if (!freshIsOffline) {
              await cache.put(request, fresh.clone());
            }
            return fresh;
          }
        } catch {
          // Network failed, fall back to whatever is cached (even if offline)
          return cached;
        }
      }

      // Return cached instantly and update in background (SWR)
      event.waitUntil((async () => {
        try {
          const fresh = (await preloadPromise) || (await networkPromise);
          if (fresh && fresh.ok && fresh.status === 200) {
            const freshIsOffline = isOfflineByHeader(fresh) || isOfflineByResponseURL(fresh) || await looksLikeOfflineHTML(fresh);
            if (!freshIsOffline) {
              await cache.put(request, fresh.clone());
            }
          }
        } catch (e) {
          // Background update failed; keep using cached
        }
      })());
      return cached;
    }

    // First visit or cache miss: try network first
    try {
      const response = (await preloadPromise) || (await networkPromise);
      // IMPORTANT: Do not treat HTTP errors (e.g., 404) as offline; return them as-is
      if (response) {
        // Cache only successful, non-offline HTML
        if (response.ok && response.status === 200) {
          const maybeOffline = isOfflineByHeader(response) || isOfflineByResponseURL(response) || await looksLikeOfflineHTML(response);
          if (!maybeOffline) {
            event.waitUntil(cache.put(request, response.clone()));
          }
        }
        return response;
      }
      // No response object; consider as network failure
      throw new Error('No response');
    } catch (error) {
      // Network failed - serve offline page but DON'T cache this response
      const offlineResponse = await caches.match('/offline/index.html') ||
                              await caches.match(getCacheKeyForURL('/offline/index.html'));
      if (offlineResponse) {
        const headers = new Headers(offlineResponse.headers);
        headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        headers.set('Expires', '0');
        headers.set(OFFLINE_HEADER, '1'); // sentinel to recognize offline fallback later
        return new Response(offlineResponse.body, {
          status: offlineResponse.status,
          statusText: offlineResponse.statusText,
          headers
        });
      }
      // Ultimate fallback
      return new Response('Offline - No cached version available', {
        status: 503,
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
      });
    }
  }
); // Custom handler preserves SWR semantics with explicit preload consumption

// ----- Capture <link rel=prefetch> navigation prefetches and persist to pages cache -----
workbox.routing.registerRoute(
  ({ url, request }) => {
    // Same-origin GET prefetches signaled by Purpose/Sec-Purpose: prefetch and empty destination
    const isSameOrigin = url.origin === self.location.origin;
    const isGET = request.method === 'GET';
    const isPrefetchHeader =
      request.headers.get('Sec-Purpose') === 'prefetch' ||
      request.headers.get('Purpose') === 'prefetch';
    const isLowPriority = request.priority === 'low'; // Additional signal for prefetch (best-effort)
    const acceptsHTML = (request.headers.get('Accept') || '').includes('text/html');
    return isSameOrigin && isGET && acceptsHTML && (isPrefetchHeader || isLowPriority) && !isOfflinePath(url);
  },
  async ({ event, request }) => {
    try {
      const response = await fetch(request); // Low-priority prefetch stays off the main path
      if (response && response.ok && response.status === 200) {
        const maybeOffline = isOfflineByHeader(response) || isOfflineByResponseURL(response) || await looksLikeOfflineHTML(response);
        if (!maybeOffline) {
          event.waitUntil((async () => {
            const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
            await cache.put(request, response.clone());
          })());
        }
      }
      return response;
    } catch {
      // Prefetch failed; do nothing special
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
  ({ url, request }) => url.origin === self.location.origin && !request.destination && !isOfflinePath(url),
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
      const headers = new Headers(offlineResponse.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      headers.set('Expires', '0');
      headers.set(OFFLINE_HEADER, '1'); // sentinel to recognize offline fallback later
      return new Response(offlineResponse.body, {
        status: offlineResponse.status,
        statusText: offlineResponse.statusText,
        headers
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
    });
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
        cache.addAll(event.data.payload.filter((url) => !isOfflinePath(url)))
      )
    );
  }

  if (event.data?.type === 'PREFETCH_URLS' && Array.isArray(event.data.urls)) {
    // Optional: window -> SW prefetch channel to warm caches in background
    event.waitUntil((async () => {
      const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
      await Promise.all(
        event.data.urls
          .filter((url) => !isOfflinePath(url))
          .map(async (u) => {
            try {
              const res = await fetch(u, { credentials: 'same-origin' });
              if (res && res.ok) {
                const maybeOffline = isOfflineByHeader(res) || isOfflineByResponseURL(res) || await looksLikeOfflineHTML(res);
                if (!maybeOffline) await cache.put(u, res.clone());
              }
            } catch {}
          })
      );
    })()); // Background-only; doesn't block UI
  }

  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }

  // Helper: Clear any cached entries that are offline fallbacks
  if (event.data?.type === 'CLEAR_BAD_CACHE') {
    event.waitUntil((async () => {
      const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
      const keys = await cache.keys();
      for (const request of keys) {
        const response = await cache.match(request);
        if (!response) continue;
        if (isOfflineByHeader(response) || isOfflineByResponseURL(response) || (await looksLikeOfflineHTML(response))) {
          await cache.delete(request);
          // eslint-disable-next-line no-console
          console.log('Cleared offline-like cached entry:', request.url);
        }
      }
    })());
  }
});

// ----- Activation: claim clients only (ExpirationPlugin handles expiration) -----
self.addEventListener('activate', (event) => {
  // eslint-disable-next-line no-console
  console.log('Service Worker activated with version:', CACHE_VERSION);
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean up any cached entries that look like offline fallbacks (safety)
      (async () => {
        const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
        const keys = await cache.keys();
        for (const request of keys) {
          const response = await cache.match(request);
          if (!response) continue;
          if (isOfflineByHeader(response) || isOfflineByResponseURL(response) || (await looksLikeOfflineHTML(response))) {
            await cache.delete(request);
            // eslint-disable-next-line no-console
            console.log('Cleaned offline-like cached entry on activation:', request.url);
          }
        }
      })()
    ])
  );
});

console.log('Service Worker loaded — Instant navigations + fast revalidation + prefetch capture');
