/* Cadence service worker: caches the app shell and fonts so it opens offline. */
const VERSION = "cadence-v17";
const SHELL = [
  "./", "index.html", "styles.css", "seed.js", "store.js", "day.js", "welcome.js", "claude.js", "sync.js", "dash.js", "app.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/qr.svg", "icons/stone.jpg", "icons/splash-c.png", "icons/splash-l0.png", "icons/splash-l1.png", "icons/splash-l2.png", "icons/splash-l3.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const fontHost = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== location.origin && !fontHost) return; // never touch api.anthropic.com
  const own = url.origin === location.origin && (req.mode === "navigate" || /\.(js|css|html)$/.test(url.pathname) || url.pathname.endsWith("/"));
  if (own) {   // app code: newest first, so an update shows on the very next open; cache only if offline or slow
    e.respondWith(new Promise(resolve => {
      const t = setTimeout(() => caches.match(req, { ignoreSearch: true }).then(h => h && resolve(h)), 3000);
      fetch(req, { cache: "no-cache" }).then(res => { clearTimeout(t); if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } resolve(res); })
        .catch(() => { clearTimeout(t); caches.match(req, { ignoreSearch: true }).then(h => resolve(h || caches.match("index.html"))); });
    }));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined));
      return hit || net; // stale-while-revalidate
    })
  );
});
