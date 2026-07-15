// §9 (built) — service worker: enables PWA installability and is what makes
// Web Push actually arrive with the tab closed (the `push` event below only
// ever fires here, never in the page). `notificationclick` is what makes
// tapping the OS notification focus (or open) the app.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A fetch handler is required for installability checks on some platforms;
// this app has no offline story yet, so it's a pure passthrough.
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let data = { title: "Relay", body: "" };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: "Relay", body: event.data.text() };
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Relay", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
