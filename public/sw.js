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

self.addEventListener("install", e => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // trades and login always hit the network
  e.respondWith(networkFirst(req, url));
});

// Network first; falls back to the cached copy when offline, failing or slow.
async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  const key = req.mode === "navigate" && url.pathname === "/" ? "/" : req;
  const cached = await cache.match(key);
  try {
    const net = fetch(req);
    const res = cached
      ? await Promise.race([net, new Promise((_, no) => setTimeout(no, SLOW_MS))])
      : await net;
    if (res.status >= 500 && cached) return cached;
    if (res.ok && !res.redirected) cache.put(key, res.clone());
    return res;
  } catch {
    if (cached) return cached;
    if (req.mode === "navigate") return (await cache.match("/")) || Response.error();
    return Response.error();
  }
}
