const CACHE_NAME = "chia-v4";
const STATIC_ASSETS = [
  "./",
  "./manifest.json",
  "./favicon.svg",
  "./icon-192.svg",
  "./icon-512.svg",
];

// Install: cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Listen for skip waiting message from the page
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Fetch handler
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin requests — don't touch cross-origin API calls
  if (new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Don't cache API requests (they're proxied in dev, cross-origin in prod)
  if (request.url.includes("/api/")) {
    return;
  }

  // Static assets: cache-first, fallback to network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback for navigation requests
      if (request.mode === "navigate") {
        return caches.match("./");
      }
    })
  );
});
