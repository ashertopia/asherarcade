/* Pursuit Camp 2026 — service worker (offline support)
   Only handles the Pursuit app assets; every other request on the site
   falls through to normal network behavior. */
const VERSION = 'pursuit-v2';
const SHELL = 'pursuit-shell-' + VERSION;
const TILES = 'pursuit-tiles';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const PRECACHE = [
  './pursuit.html',
  './manifest.webmanifest',
  './pursuit-icon-180.png',
  './pursuit-icon-192.png',
  './pursuit-icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(PRECACHE);            // same-origin app files — must succeed, never hangs
    // Best-effort background precache of Leaflet (NOT awaited, so install never blocks).
    Promise.allSettled([LEAFLET_JS, LEAFLET_CSS].map(u =>
      fetch(new Request(u, { mode: 'no-cors' })).then(r => c.put(u, r))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('pursuit-shell-') && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isPursuitNav(url, req) {
  return req.mode === 'navigate' && url.pathname.endsWith('/pursuit.html');
}
function isShellAsset(url) {
  return url.pathname.endsWith('/pursuit.html') ||
         url.pathname.endsWith('/manifest.webmanifest') ||
         /\/pursuit-icon-\d+\.png$/.test(url.pathname) ||
         (url.host === 'unpkg.com' && url.pathname.includes('leaflet'));
}
function isTile(url) { return url.host.indexOf('arcgisonline.com') !== -1; }

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App page: NETWORK-FIRST so an online open always gets the newest version;
  // fall back to cache (instant) if offline or the network is slow (>3.5s).
  if (isPursuitNav(url, req) || (isShellAsset(url) && url.pathname.endsWith('/pursuit.html'))) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      try {
        const net = await fetch(req, { signal: controller.signal });
        clearTimeout(timer);
        if (net && net.ok) { cache.put('./pursuit.html', net.clone()); return net; }
        throw new Error('bad response');
      } catch (_) {
        clearTimeout(timer);
        return (await cache.match('./pursuit.html')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Other shell assets (leaflet, manifest, icons): cache-first, cache on first load.
  if (isShellAsset(url)) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
        return r;
      } catch (_) { return hit || Response.error(); }
    })());
    return;
  }

  // Satellite tiles: cache the ones they view so those areas work offline.
  if (isTile(url)) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); c.put(req, r.clone()); return r; }
      catch (_) { return hit || new Response('', { status: 504 }); }
    })());
    return;
  }
  // Everything else on the site: default network behavior (not intercepted).
});
