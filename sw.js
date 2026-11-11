// Mini Mayor service worker: makes the game work offline once it has been opened.
// Strategy: answer from the cache right away, and refresh the cache in the
// background so the next launch picks up any update.
const CACHE = 'bitcity-v32';
const FILES = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/main.js', './js/config.js', './js/state.js', './js/sim.js',
  './js/sprites.js', './js/terrain.js', './js/render.js', './js/ui.js', './js/audio.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
