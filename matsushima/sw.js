// Offline cache for the Matsushima game. Bump VERSION when shipping new assets.
const VERSION = 'mts-v1';
const CORE = ['./', './index.html', './height.png', './photo.jpg', './places.json',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './three.min.js'];
self.addEventListener('install', e => {
  // add one by one so a single failed download (e.g. a flaky connection) does not abort offline support
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Stale-while-revalidate: instant start from cache, refresh in the background (fonts included).
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
