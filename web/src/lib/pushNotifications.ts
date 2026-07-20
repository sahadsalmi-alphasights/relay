// §9 (built) — browser Notification popups while a tab is open. Separate from
// Web Push (see web/src/lib/webPush.ts), which is what reaches the user with
// the tab closed; this just needs Notification permission, no subscription.

export async function showBrowserNotification(title: string, body: string): Promise<void> {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/icons/icon-192.png" });
  } catch {
    // Mobile Chrome/Android (and iOS Safari) forbid constructing Notification
    // directly and require the service worker registration instead. Fall back
    // to that so foreground pop-ups work on those browsers too, rather than
    // silently doing nothing. The inner catch keeps a rejected
    // serviceWorker.ready from becoming an unhandled rejection (callers fire
    // this un-awaited).
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, icon: "/icons/icon-192.png" });
    } catch {
      // in-app bell + Web Push still cover this notification
    }
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}
