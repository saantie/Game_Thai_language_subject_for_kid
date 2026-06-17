// sw.js — Service Worker: cache-first + stale-while-revalidate + auto-reload on update
// bump CACHE string ทุกครั้งที่ deploy ใหม่ → browser detect diff → install → reload client
const CACHE = 'witch-cauldron-v4';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/main.js',
  './src/game.js',
  './src/scene.js',
  './src/audio.js',
  './src/styles.css',
  './src/data/matra.js',
  './src/input/pointer.js',
  './src/input/handpinch.js',
  './src/input/speech.js',
  './src/ui/levelSelect.js',
  './src/ui/adultPage.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      const oldKeys = keys.filter((k) => k !== CACHE);
      return Promise.all(oldKeys.map((k) => caches.delete(k)))
        .then(() => self.clients.claim())
        .then(() => {
          if (oldKeys.length === 0) return; // first install — ไม่ต้อง reload
          // SW version ใหม่ replace เก่า → แจ้ง tab ที่เปิดอยู่ให้ reload รับ code ล่าสุด
          return self.clients
            .matchAll({ type: 'window' })
            .then((clients) => clients.forEach((c) => c.postMessage({ type: 'SW_UPDATED' })));
        });
    })
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const isSameOrigin = new URL(req.url).origin === self.location.origin;

  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        // revalidate ใน background ทุกครั้ง (stale-while-revalidate)
        const networkFetch = fetch(req)
          .then((res) => {
            if (res.ok && isSameOrigin) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);

        if (cached) {
          e.waitUntil(networkFetch); // update cache แต่ไม่รอ — return ทันที
          return cached;
        }
        // ไม่มีใน cache → รอ network; ถ้า offline + navigate → fallback index.html
        return networkFetch.then(
          (res) => res || (req.mode === 'navigate' ? cache.match('./index.html') : null)
        );
      })
    )
  );
});
