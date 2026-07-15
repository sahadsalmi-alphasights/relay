import type { FastifyPluginAsync } from "fastify";
import { findPersonById } from "../repositories/people";
import { findRotaEntry } from "../repositories/sundayRota";
import { createSwapRequest, findSwapRequestById, listSwapRequestsForTeam, resolveSwapRequest } from "../repositories/sundaySwapRequests";
import { badRequest, forbidden, notFound } from "../errors";
import { canResolveSundaySwap } from "../rules/permissions";
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
    if (!q.teamId) throw badRequest("teamId is required");
    return listSwapRequestsForTeam(q.teamId);
  });

  app.patch<{ Params: { id: string } }>("/:id/resolve", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const swapRequest = await findSwapRequestById(request.params.id);
    if (!swapRequest) throw notFound("swap request not found");
    const requester = await findPersonById(swapRequest.requestedBy);
    if (!requester) throw notFound("requester not found");
    if (!canResolveSundaySwap(actor, { teamId: requester.teamId })) {
      throw forbidden("only a manager may resolve a swap request for their own team");
    }
    const resolved = await resolveSwapRequest(swapRequest.id);
    publish({ type: "sunday-rota" });
    return resolved;
  });
};

export default sundaySwapRequestsRoutes;
