// Offline režim: aplikace se otevře i bez signálu (vždy se zkusí nejdřív nová verze ze sítě)
const CACHE = "trimates-v2";
const CORE = ["./", "index.html", "styles.css", "app.js"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  const own = u.origin === location.origin;
  const font = /^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!own && !font) return; // data z GitHubu si aplikace ukládá sama
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
