const CACHE_NAME = "labible-zero-v3";
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/offline.html",
  "/a-propos.html",
  "/contact.html",
  "/confidentialite.html",
  "/mentions-legales.html",
  "/conditions.html",
  "/assets/style.css",
  "/assets/app.js",
  "/manifest.webmanifest",
  "/data/books.json",
  "/data/segond_1910.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // anti-404: tenta 1 a 1 (um erro nao mata o SW)
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try { await cache.add(url); } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return;

  // Navegacao: network-first com fallback offline
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (
          (await cache.match(req)) ||
          (await cache.match("/index.html")) ||
          (await cache.match(OFFLINE_URL))
        );
      }
    })());
    return;
  }

  // Assets/JSON: cache-first
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
      return fresh;
    } catch {
      return cached || Response.error();
    }
  })());
});
