// 缓存应用外壳，让主屏幕版本在断网时也能启动。
const CACHE_NAME = "xiaozhangben-v6";
const APP_FILES = ["./", "./index.html", "./styles.css?v=6", "./app.js?v=6", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // 联网时优先取新版；断网时才使用缓存，避免主屏幕应用长期停留在旧版本。
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(event.request)) || (event.request.mode === "navigate" ? caches.match("./") : Response.error());
    }
  })());
});
