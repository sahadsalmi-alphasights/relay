import type { FastifyPluginAsync } from "fastify";
import { countUnread, listForPerson, markAllRead, markRead } from "../repositories/notifications";
import { notFound } from "../errors";

/** §9 (built) — the in-app notification centre: always scoped to the caller's own notifications. */
const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const [notifications, unreadCount] = await Promise.all([listForPerson(actor.id), countUnread(actor.id)]);
    return { notifications, unreadCount };
  });

  app.patch<{ Params: { id: string } }>("/:id/read", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const updated = await markRead(request.params.id, actor.id);
    if (!updated) throw notFound("notification not found");
    return updated;
  });

  app.post("/read-all", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    await markAllRead(actor.id);
    return { ok: true };
  });
};

export default notificationsRoutes;
