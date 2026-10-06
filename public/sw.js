/* Bullion Droid service worker (hand-rolled — no next-pwa).
   Rules, in order of data honesty:
   - /api/*  → NETWORK ONLY. A cached tape would show stale prices as if live.
   - HTML navigations → network-first, offline falls back to the cached copy of
     that path, then to /home so the shell always opens.
   - /_next/static and icons → cache-first (immutable by content hash).
   Dev is never cached (registration only happens in production). */

const VERSION = "bullion-droid-v2";
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

// Daily opening-score ping: Android Chrome wakes the SW when the user has
// periodic sync armed, so the 09:00 IST score lands without a push worker.
self.addEventListener("periodicsync", (event) => {
  if (event.tag !== "openping-daily") return;
  event.waitUntil(
    fetch("/api/opening", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("opening failed"))))
      .then((j) => {
        const op = j && j.predict;
        if (!op) throw new Error("opening shape");
        const call = { GREEN: "GAP UP", RED: "GAP DOWN", FLAT: "STAND ASIDE", NO_DATA: "NO CALL" }[op.verdict] || op.verdict || "—";
        const edge = typeof op.edge === "number" && isFinite(op.edge) ? (op.edge >= 0 ? "+" : "") + op.edge.toFixed(2) : "—";
        const gap = typeof op.expectedGapPct === "number" && isFinite(op.expectedGapPct) ? (op.expectedGapPct >= 0 ? "+" : "") + op.expectedGapPct.toFixed(2) + "%" : "—";
        const conf = typeof op.confidence === "number" && isFinite(op.confidence) ? Math.round(op.confidence * 100) + "%" : "—";
        return self.registration.showNotification("OPENING CALL: " + call, {
          body: "EDGE " + edge + " · EXP GAP " + gap + " · CONF " + conf + " · MODULE 109",
          tag: "openping-daily",
          renotify: true,
        });
      })
      .catch(() => undefined)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return clients.openWindow("/home");
    })
  );
});
