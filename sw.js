importScripts('env-config.js');

const APP_VERSION = '1.9.0';
const ENV_CONFIG = self.FD?.Env?.config || self.FD_ENV_CONFIG || {};
const CACHE_NAME = typeof ENV_CONFIG.cacheNameForVersion === 'function'
  ? ENV_CONFIG.cacheNameForVersion(APP_VERSION)
  : `fd-v${APP_VERSION}`;
const CACHE_PREFIX = String(ENV_CONFIG.cachePrefix || 'fd-v');
const WORKER_API_HOSTNAME = ENV_CONFIG.workerApiHostname || (() => {
  try {
    return new URL(ENV_CONFIG.workerApiBaseUrl || 'https://floorplan-dashboard-api.mko-floorplan-dashboard.workers.dev').hostname;
  } catch {
    return 'floorplan-dashboard-api.mko-floorplan-dashboard.workers.dev';
  }
})();

function isManagedCacheName(cacheName) {
  const name = String(cacheName || '');
  if (CACHE_PREFIX === 'fd-live-v') {
    return name.startsWith(CACHE_PREFIX) || /^fd-v\d+\.\d+\.\d+$/i.test(name);
  }
  if (CACHE_PREFIX === 'fd-v') {
    return /^fd-v\d+\.\d+\.\d+$/i.test(name);
  }
  return name.startsWith(CACHE_PREFIX);
}

const STATIC_ASSETS = [
  './',
  'index.html',
  'admin-dashboard-tokens.css?v=1.9.0',
  'app.css?v=1.9.0',
  'env-config.js?v=1.9.0',
  'data-service.js?v=1.9.0',
  'diagnostics-service.js?v=1.9.0',
  'floorplan-cache-service.js?v=1.9.0',
  'floorplan-view-service.js?v=1.9.0',
  'auth-service.js?v=1.9.0',
  'status-service.js?v=1.9.0',
  'status-sync-service.js?v=1.9.0',
  'mode-service.js?v=1.9.0',
  'image-editor-service.js?v=1.9.0',
  'viewport-service.js?v=1.9.0',
  'marker-service.js?v=1.9.0',
  'door-action-service.js?v=1.9.0',
  'ui-shell-service.js?v=1.9.0',
  'edit-ui-service.js?v=1.9.0',
  'pdf-import-service.js?v=1.9.0',
  'upload-service.js?v=1.9.0',
  'select-sheet-service.js?v=1.9.0',
  'side-panel-service.js?v=1.9.0',
  'app.js?v=1.9.0',
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
        keys.filter(k => k !== CACHE_NAME && isManagedCacheName(k)).map(k => caches.delete(k))
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
