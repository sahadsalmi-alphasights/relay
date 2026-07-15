// §9 (built) — browser Notification popups while a tab is open. Separate from
// Web Push (see web/src/lib/webPush.ts), which is what reaches the user with
// the tab closed; this just needs Notification permission, no subscription.

export function showBrowserNotification(title: string, body: string): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/icons/icon-192.png" });
  } catch {
    // Some browsers throw when constructing Notification directly (e.g. iOS
    // Safari wants it via a service worker registration); safe to ignore --
    // the in-app bell and Web Push already cover this notification.
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}
