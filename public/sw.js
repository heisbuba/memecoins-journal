const CACHE = "journal-shell-v1";
const SHELL = [
  "/",
  "/style.css",
  "/calc.js",
  "/app.js",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png"
];
const SLOW_MS = 4000;

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(networkFirst(request, url));
});

// Network first; falls back to the cached copy when offline, failing or slow.
async function networkFirst(request, url) {
  const cache = await caches.open(CACHE);
  const cacheKey = request.mode === "navigate" && url.pathname === "/" ? "/" : request;
  const cachedResponse = await cache.match(cacheKey);
  try {
    const networkRequest = fetch(request);
    const response = cachedResponse
      ? await Promise.race([networkRequest, new Promise((_, reject) => setTimeout(reject, SLOW_MS))])
      : await networkRequest;
    if (response.status >= 500 && cachedResponse) return cachedResponse;
    if (response.ok && !response.redirected) cache.put(cacheKey, response.clone());
    return response;
  } catch {
    if (cachedResponse) return cachedResponse;
    if (request.mode === "navigate") return (await cache.match("/")) || Response.error();
    return Response.error();
  }
}
