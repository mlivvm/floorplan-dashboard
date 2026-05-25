const CACHE_NAME = 'fd-v1.8.163';
const WORKER_API_HOSTNAME = 'floorplan-dashboard-api.mko-floorplan-dashboard.workers.dev';

const STATIC_ASSETS = [
  './',
  'index.html',
  'admin-dashboard-tokens.css?v=1.8.163',
  'app.css?v=1.8.163',
  'data-service.js?v=1.8.163',
  'diagnostics-service.js?v=1.8.163',
  'floorplan-cache-service.js?v=1.8.163',
  'floorplan-view-service.js?v=1.8.163',
  'auth-service.js?v=1.8.163',
  'status-service.js?v=1.8.163',
  'status-sync-service.js?v=1.8.163',
  'mode-service.js?v=1.8.163',
  'image-editor-service.js?v=1.8.163',
  'viewport-service.js?v=1.8.163',
  'marker-service.js?v=1.8.163',
  'door-action-service.js?v=1.8.163',
  'ui-shell-service.js?v=1.8.163',
  'edit-ui-service.js?v=1.8.163',
  'pdf-import-service.js?v=1.8.163',
  'upload-service.js?v=1.8.163',
  'select-sheet-service.js?v=1.8.163',
  'side-panel-service.js?v=1.8.163',
  'app.js?v=1.8.163',
  'version.json',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
];

function offlineMissResponse() {
  return new Response('Offline cache miss', {
    status: 504,
    statusText: 'Offline cache miss',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function cacheFallback(request) {
  return caches.match(request).then(cached => cached || offlineMissResponse());
}

function noStoreRequest(request) {
  return new Request(request, { cache: 'no-store' });
}

function isCacheableWorkerGet(url) {
  return url.hostname === WORKER_API_HOSTNAME && url.pathname === '/api/floorplan';
}

async function precacheStaticAssets(cache) {
  await Promise.all(STATIC_ASSETS.map(async asset => {
    const request = noStoreRequest(asset);
    const response = await fetch(request);
    if (!response.ok) throw new Error(`Precache failed: ${asset}`);
    await cache.put(request, response);
  }));
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => precacheStaticAssets(cache))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'FD_SKIP_WAITING') {
    e.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Version checks must reflect the current deployment, not an old app cache.
  if (url.origin === self.location.origin && url.pathname.endsWith('/version.json')) {
    e.respondWith(
      fetch(noStoreRequest(e.request))
        .catch(() => offlineMissResponse())
    );
    return;
  }

  // Never cache external services with mutable/auth side effects
  if (url.hostname === 'eu.jotform.com' ||
      url.hostname === 'ipapi.co' ||
      url.hostname === 'api.emailjs.com' ||
      url.hostname === 'api.ipify.org') {
    return;
  }

  // Cloudflare Worker writes and auth-dependent reads must remain network-only.
  // Floorplan SVG GETs are the only Worker responses cached for offline use.
  if (url.hostname === WORKER_API_HOSTNAME) {
    if (e.request.method !== 'GET') return;

    if (!isCacheableWorkerGet(url)) {
      e.respondWith(
        fetch(noStoreRequest(e.request))
          .catch(() => offlineMissResponse())
      );
      return;
    }

    e.respondWith(
      fetch(noStoreRequest(e.request))
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => cacheFallback(e.request))
    );
    return;
  }

  // CDN scripts: cache-first (versioned URLs, won't change)
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'unpkg.com' || url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request)
          .then(resp => {
            if (resp.ok) {
              const clone = resp.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
            }
            return resp;
          })
          .catch(() => offlineMissResponse());
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Static assets: network-first, fall back to cache
  e.respondWith(
    fetch(noStoreRequest(e.request))
      .then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => cacheFallback(e.request))
  );
});
