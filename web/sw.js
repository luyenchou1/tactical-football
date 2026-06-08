// Tactical Football — service worker. Caches the app shell so the game
// loads instantly and works fully offline once installed.
const CACHE = 'tf-v43';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'sim.js',
  'game.js',
  'zzfx.js',
  'sound.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function (hit) {
      if (hit) return hit;
      return fetch(event.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) {
          try { cache.put(event.request, copy); } catch (e) {}
        });
        return res;
      }).catch(function () {
        // offline navigation fallback
        if (event.request.mode === 'navigate') return caches.match('index.html');
      });
    })
  );
});
