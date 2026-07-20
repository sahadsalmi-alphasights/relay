import type { FastifyPluginAsync } from "fastify";
import { config } from "../config";
import { badRequest } from "../errors";
import { deleteSubscription, upsertSubscription } from "../repositories/pushSubscriptions";

/**
 * §9 (built) — Web Push subscription management. Never auto-subscribes
 * anyone; the client only calls these after the user explicitly opts in
 * (see spec §9a). Subscriptions are per-person, one row per browser/device.
 */
const pushRoutes: FastifyPluginAsync = async (app) => {
  app.get("/vapid-public-key", { preHandler: [app.requireAuth] }, async () => ({
    publicKey: config.vapidPublicKey,
  }));

  app.post<{ Body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }>(
    "/subscribe",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const { endpoint, keys } = request.body ?? {};
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        throw badRequest("endpoint and keys.p256dh/keys.auth are required");
      }
      const sub = await upsertSubscription(actor.id, { endpoint, p256dh: keys.p256dh, auth: keys.auth });
      return sub;
    }
  );

  app.post<{ Body: { endpoint?: string } }>("/unsubscribe", { preHandler: [app.requireAuth] }, async (request) => {
    if (!request.body?.endpoint) throw badRequest("endpoint is required");
    await deleteSubscription(request.body.endpoint, request.actor!.id);
    return { ok: true };
  });
};

export default pushRoutes;
