// sw.js — Service Worker: แคช app shell ให้เล่น offline ได้ (cache-first)
// path ทั้งหมดเป็น relative กับตำแหน่ง sw.js (root scope) → ใช้ได้ทั้ง localhost และ subpath ของ GitHub Pages
const CACHE = 'witch-cauldron-v1';

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
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          // แคชเฉพาะ same-origin ที่สำเร็จ (ฟอนต์ข้าม origin ปล่อยให้เบราว์เซอร์จัดการ)
          if (res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // offline + ไม่มีในแคช → ถ้าเป็น navigation ให้ fallback index.html
          if (req.mode === 'navigate') return caches.match('./index.html');
        });
    })
  );
});
