// Service Worker with Workbox 7.3.0 (Local) — Instant navigations + background sitemap warming + image fallback + aggressive caching

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

// Bump when changing caching behavior
const CACHE_VERSION = 'v1';

// Sitemap warm-up settings
const SITEMAP_CANDIDATES = [
  '/sitemap.xml',
  'index.xml'
];
const SITEMAP_WARM_LIMIT = 1500;     // total pages to warm per session
const SITEMAP_CONCURRENCY = 8;       // parallel fetches during warm
let SITEMAP_WARMED = false;          // guard to run once per SW life

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

// ----- Precache critical assets early (cache-first by precaching) -----
precacheAndRoute([
  { url: '/offline/index.html', revision: CACHE_VERSION },
  { url: '/manifest.json', revision: CACHE_VERSION },
  { url: '/site.webmanifest', revision: CACHE_VERSION }
]);

// NOTE: Navigation Preload is disabled for max “instant” feel with SWR navigations.

// ----- Helper: background sitemap warm-up (pages only) -----
async function fetchText(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Failed ${res.status} for ${url}`);
  return await res.text();
}

function extractLocsFromSitemap(xml) {
  const locs = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    locs.push(m[1].trim());
  }
  return locs;
}

async function resolveSitemapUrls() {
  // Try main candidates, follow index to sub-sitemaps if present
  const visited = new Set();
  const queue = [...SITEMAP_CANDIDATES.map((u) => new URL(u, self.location.origin).href)];
  const pageUrls = new Set();

  while (queue.length && pageUrls.size < SITEMAP_WARM_LIMIT) {
    const u = queue.shift();
    if (visited.has(u)) continue;
    visited.add(u);

    try {
      const xml = await fetchText(u);
      const locs = extractLocsFromSitemap(xml);
      // Heuristic: if the XML contains <sitemap>, treat locs as sub-sitemaps; otherwise treat as page URLs
      const isIndex = /<sitemapindex/i.test(xml) || /<sitemap>/i.test(xml);
      for (const loc of locs) {
        const href = new URL(loc, self.location.origin).href;
        if (new URL(href).origin !== self.location.origin) continue; // same-origin only
        if (isIndex) {
          queue.push(href);
        } else {
          pageUrls.add(href);
          if (pageUrls.size >= SITEMAP_WARM_LIMIT) break;
        }
      }
    } catch {
      // Ignore broken sitemap URL and continue
    }
  }
  return Array.from(pageUrls);
}

async function warmPages(urls, concurrency = SITEMAP_CONCURRENCY) {
  const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
  let i = 0;
  const workers = Array.from({ length: concurrency }, () => (async function run() {
    while (i < urls.length) {
      const idx = i++;
      const u = urls[idx];
      try {
        const req = new Request(u, { credentials: 'same-origin' });
        const already = await cache.match(req);
        if (already) continue; // skip if present
        const res = await fetch(req);
        const ct = res.headers.get('Content-Type') || '';
        if (res.ok && ct.includes('text/html')) {
          await cache.put(req, res.clone());
        }
      } catch {
        // Ignore failures during warming
      }
    }
  })());
  await Promise.all(workers);
}

async function warmSitemapOnce() {
  if (SITEMAP_WARMED) return;
  SITEMAP_WARMED = true;
  try {
    const urls = await resolveSitemapUrls();
    if (urls.length) await warmPages(urls);
  } catch {
    // Ignore errors; warming is best-effort
  }
}

// Trigger warming after first controlled navigation without blocking response
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode === 'navigate') {
    // Fire-and-forget; do not block navigation
    event.waitUntil(warmSitemapOnce());
  }
});

// ----- Navigations: Stale-While-Revalidate (instant cache, background refresh) -----
workbox.routing.registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !isOfflinePath(url),
  new StaleWhileRevalidate({
    cacheName: `pages-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 3000,                    // cache even more pages
        maxAgeSeconds: 180 * 24 * 60 * 60,   // 180 days
        purgeOnQuotaError: true
      })
    ]
  })
);

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
      return fetch(request);
    }
  }
);

// ----- CSS — Cache-First (fastest repeat paints) -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'style',
  new CacheFirst({
    cacheName: `css-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 1500,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ----- JavaScript — Cache-First (fastest TTI on repeat visits) -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'script',
  new CacheFirst({
    cacheName: `js-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 1500,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ----- Images — Cache-First (instant) with generous limits -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: `image-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 8000,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ----- Fonts — Cache-First -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: `font-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 1500,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ----- Audio/Video — Cache-First + Range Requests -----
workbox.routing.registerRoute(
  ({ request }) => request.destination === 'audio' || request.destination === 'video',
  new CacheFirst({
    cacheName: `media-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200, 206] }),
      new workbox.rangeRequests.RangeRequestsPlugin(),
      new ExpirationPlugin({
        maxEntries: 1000,
        maxAgeSeconds: 180 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
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
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 3000,
        maxAgeSeconds: 365 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ----- API — Network-First (short TTL) -----
workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new workbox.strategies.NetworkFirst({
    cacheName: `api-cache-${CACHE_VERSION}`,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 800,
        maxAgeSeconds: 10 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ----- Same-origin catch-all (no destination) — SWR -----
workbox.routing.registerRoute(
  ({ url, request }) => url.origin === self.location.origin && !request.destination && !isOfflinePath(url),
  new StaleWhileRevalidate({
    cacheName: `misc-cache-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 3000,
        maxAgeSeconds: 180 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

// ----- Offline fallback (documents + images placeholder) -----
workbox.routing.setCatchHandler(async ({ event }) => {
  const dest = event.request.destination;

  // Documents: return offline page
  if (dest === 'document' || event.request.mode === 'navigate') {
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

  // Images: SVG placeholder so layout doesn’t break when offline
  if (dest === 'image') {
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect fill="#f3f4f6" width="400" height="300"/><text x="50%" y="50%" font-family="Arial,sans-serif" font-size="16" text-anchor="middle" dy=".3em" fill="#9ca3af">Offline</text></svg>',
      { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } }
    );
  }

  // Other types: error
  return Response.error();
});

// ----- Messaging: manual warmup/clear (optional from page) -----
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();

  if (event.data?.type === 'PREFETCH_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(`pages-cache-${CACHE_VERSION}`);
      await Promise.all(
        event.data.urls.map(async (u) => {
          try {
            const req = new Request(u, { credentials: 'same-origin' });
            const res = await fetch(req);
            const ct = res.headers.get('Content-Type') || '';
            if (res && res.ok && ct.includes('text/html')) await cache.put(req, res.clone());
          } catch {}
        })
      );
    })());
  }

  if (event.data?.type === 'WARM_SITEMAP_NOW') {
    event.waitUntil(warmSitemapOnce());
  }

  if (event.data?.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }
});

// ----- Activation: claim clients only (let ExpirationPlugin handle TTL) -----
self.addEventListener('activate', (event) => {
  console.log('Service Worker activated with version:', CACHE_VERSION);
  event.waitUntil(self.clients.claim());
});

console.log('Service Worker loaded — Instant navigations + background sitemap warming + image fallback + aggressive caching');
