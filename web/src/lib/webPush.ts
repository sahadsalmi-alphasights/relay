import { api } from "../api/client";
import { requestNotificationPermission } from "./pushNotifications";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export type PushEnableResult = { ok: true } | { ok: false; reason: string };

/**
 * §9 (built) — never called automatically. Only invoked from an explicit
 * "enable notifications" click (see NotificationBell) so opting in is
 * always the user's own choice, never assumed.
 *
 * Every failure returns a human-readable reason instead of a bare false:
 * the toggle silently snapping back (with the real cause buried in the
 * console) is exactly the bug this replaced.
 */
export async function enablePush(): Promise<PushEnableResult> {
  if (!isPushSupported()) return { ok: false, reason: "This browser doesn't support push." };

  const permission = await requestNotificationPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "Notifications are blocked for this site — allow them in the browser's site settings first." };
  }

  let publicKey: string;
  try {
    ({ publicKey } = await api.get<{ publicKey: string }>("/push/vapid-public-key"));
  } catch {
    return { ok: false, reason: "Couldn't fetch the push key from the server." };
  }
  if (!publicKey) {
    // config.vapidPublicKey defaults to "" — the server env simply has no keys.
    return { ok: false, reason: "Push isn't set up on the server yet (missing VAPID keys) — ask an owner." };
  }

  // .ready never settles when no service worker registered — guard so the
  // toggle can't hang in its busy state forever.
  const registered = await navigator.serviceWorker.getRegistration();
  if (!registered) return { ok: false, reason: "The app's service worker isn't registered — try a hard refresh." };
  const reg = await navigator.serviceWorker.ready;

  let sub: PushSubscription;
  try {
    const existing = await reg.pushManager.getSubscription();
    sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // TS's lib.dom BufferSource typing is overly strict about Uint8Array's
        // buffer variance here; this is a plain ArrayBuffer at runtime.
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      }));
  } catch {
    return { ok: false, reason: "The browser refused to create a push subscription." };
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: "The browser returned an incomplete subscription." };
  }

  try {
    await api.post("/push/subscribe", {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
  } catch {
    return { ok: false, reason: "Couldn't save the subscription on the server." };
  }
  return { ok: true };
}

export async function disablePush(): Promise<void> {
  const sub = await getPushSubscription();
  if (!sub) return;
  await api.post("/push/unsubscribe", { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
