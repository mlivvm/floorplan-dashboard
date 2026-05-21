const CACHE_NAME = 'fd-v1.8.136';

const STATIC_ASSETS = [
  './',
  'index.html',
  'app.css',
  'data-service.js',
  'diagnostics-service.js',
  'floorplan-cache-service.js',
  'floorplan-view-service.js',
  'auth-service.js',
  'status-service.js',
  'status-sync-service.js',
  'mode-service.js',
  'image-editor-service.js',
  'viewport-service.js',
  'marker-service.js',
  'door-action-service.js',
  'ui-shell-service.js',
  'edit-ui-service.js',
  'pdf-import-service.js',
  'upload-service.js',
  'select-sheet-service.js',
  'side-panel-service.js',
  'app.js',
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

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
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

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Version checks must reflect the current deployment, not an old app cache.
  if (url.origin === self.location.origin && url.pathname.endsWith('/version.json')) {
    e.respondWith(
      fetch(new Request(e.request, { cache: 'no-store' }))
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

  // Cloudflare Worker writes must remain network-only. Safe read endpoints are
  // network-first with cache fallback for default Worker read integration.
  if (url.hostname === 'floorplan-dashboard-api.mko-floorplan-dashboard.workers.dev') {
    if (e.request.method !== 'GET') return;

    e.respondWith(
      fetch(e.request)
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

  // Static assets: network-first, fall back to cache
  e.respondWith(
    fetch(e.request)
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
