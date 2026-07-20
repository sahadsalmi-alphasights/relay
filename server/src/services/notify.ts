import webpush from "web-push";
import { config } from "../config";
import { createNotification, type CreateNotificationInput } from "../repositories/notifications";
import { deleteSubscriptionById, listForPerson } from "../repositories/pushSubscriptions";
import { publish } from "../ws/hub";

if (config.vapidPublicKey && config.vapidPrivateKey) {
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
}

/**
 * §9 (built) — the one place a notification is ever created. Fans out to all
 * three channels: persist (survives a refresh, drives the bell), push over
 * the live socket to that person only (never their team), and Web Push to
 * every device they've opted into (works with the tab closed).
 */
export async function notify(input: CreateNotificationInput): Promise<void> {
  const row = await createNotification(input);

  publish(
    {
      type: "notification",
      notification: {
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        createdAt: row.createdAt,
        entityType: row.entityType,
        entityId: row.entityId,
      },
    },
    new Set([input.personId])
  );

  await sendWebPush(input.personId, row.title, row.body);
}

async function sendWebPush(personId: string, title: string, body: string): Promise<void> {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) return; // not configured (e.g. some test runs) -- in-app + WS still work
  const subscriptions = await listForPerson(personId);
  const payload = JSON.stringify({ title, body });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        // 404/410 -- the browser has dropped this subscription; stop trying it.
        if (statusCode === 404 || statusCode === 410) {
          await deleteSubscriptionById(sub.id);
        }
      }
    })
  );
}
