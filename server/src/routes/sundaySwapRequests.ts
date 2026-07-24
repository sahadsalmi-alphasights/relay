import type { FastifyPluginAsync } from "fastify";
import { findRotaEntry } from "../repositories/sundayRota";
import {
  createSwapRequest,
  findSwapRequestById,
  listAllSwapRequests,
  listSwapRequestsForTeam,
  resolveSwapRequest,
} from "../repositories/sundaySwapRequests";
import { badRequest, forbidden, notFound } from "../errors";
import { canManageAnySundayRota } from "../rules/permissions";
import { publish } from "../ws/hub";

/** §4 Rule 2 — a rostered person may request a swap; only a manager may resolve it. */
const sundaySwapRequestsRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { rotaDate?: string; note?: string } }>("/", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const { rotaDate, note } = request.body ?? {};
    if (!rotaDate) throw badRequest("rotaDate is required");
    const rotaEntry = await findRotaEntry(rotaDate, actor.id);
    if (!rotaEntry) throw badRequest("you are not rostered for that date");
    return createSwapRequest(rotaDate, actor.id, note);
  });

  app.get("/", { preHandler: [app.requireAuth] }, async (request) => {
    const q = request.query as { teamId?: string };
    // teamId omitted → BU-wide (Sunday Coverage page); given → one team.
    return q.teamId ? listSwapRequestsForTeam(q.teamId) : listAllSwapRequests();
  });

  app.patch<{ Params: { id: string } }>("/:id/resolve", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const swapRequest = await findSwapRequestById(request.params.id);
    if (!swapRequest) throw notFound("swap request not found");
    // BU-wide (2026-07-24): any manager/owner may resolve a swap, not just the
    // requester's own-team manager.
    if (!canManageAnySundayRota(actor)) {
      throw forbidden("only a manager may resolve a swap request");
    }
    const resolved = await resolveSwapRequest(swapRequest.id);
    publish({ type: "sunday-rota" });
    return resolved;
  });
};

export default sundaySwapRequestsRoutes;
