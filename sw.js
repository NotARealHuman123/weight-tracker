/* Service worker: makes the app work offline.
   When you change ANY file, bump VERSION below (e.g. v1.0.1) so phones download the new files. */
const VERSION = 'v1.0.0';
const CACHE = 'wt-shell-' + VERSION;
const RUNTIME = 'wt-runtime';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('wt-shell-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Product lookups always go to the network (results are cached in IndexedDB by the app).
  if (url.hostname.endsWith('openfoodfacts.org')) return;

  // App files: cache first, fall back to network.
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(caches.match('./index.html').then(r => r || fetch(req)));
      return;
    }
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req))
    );
    return;
  }

  // Fallback scanner library from the CDN: keep a copy for offline use.
  if (url.hostname === 'unpkg.com') {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
});
