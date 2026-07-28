const CACHE_NAME = "chia-runtime-v1";

// Install: activate immediately
self.addEventListener("install", () => {
  self.skipWaiting();
});

// Activate: clean old caches and take control
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (url.origin !== self.location.origin || request.method !== "GET") return;

  // Don't cache API requests
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests (HTML pages): network-first
  // This ensures users always get the latest index.html
  if (request.mode === "navigate") {
    event.respondWith(
      // Explicitly bypass the browser HTTP cache. The runtime cache below is
      // only an offline fallback, never the source of an online app update.
      fetch(request, { cache: "no-store" })
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // Hashed assets (JS/CSS with content hash): cache-first
  // These are immutable — the filename changes when content changes
  if (url.pathname.match(/\/assets\/.+-[A-Za-z0-9_-]+\.[^.]+$/)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else (icons, manifest, fonts): network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
