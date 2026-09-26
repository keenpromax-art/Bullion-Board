/* Bullion Droid service worker (hand-rolled — no next-pwa).
   Rules, in order of data honesty:
   - /api/*  → NETWORK ONLY. A cached tape would show stale prices as if live.
   - HTML navigations → network-first, offline falls back to the cached copy of
     that path, then to /home so the shell always opens.
   - /_next/static and icons → cache-first (immutable by content hash).
   Dev is never cached (registration only happens in production). */

const VERSION = "bullion-droid-v1";
const SHELL = "/home";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll([SHELL, "/manifest.webmanifest"]).catch(() => undefined))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Live tape: never answer a data request from cache.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network first, cached copy only when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy).catch(() => undefined));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match(SHELL).then((s) => s || Response.error()))
        )
    );
    return;
  }

  // Hashed build assets + icons: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy).catch(() => undefined));
            }
            return res;
          })
      )
    );
  }
});
