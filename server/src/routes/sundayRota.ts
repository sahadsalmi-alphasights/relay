import type { FastifyPluginAsync } from "fastify";
import { findPersonById } from "../repositories/people";
import {
  addRotaEntry,
  findRotaEntryById,
  listAllRota,
  listRotaForTeam,
  removeRotaEntry,
} from "../repositories/sundayRota";
import { badRequest, forbidden, notFound } from "../errors";
import { canManageAnySundayRota } from "../rules/permissions";
import { publish } from "../ws/hub";

/**
 * §4 Rule 2 — a schedule, not a preference. Read is open to everyone; writing
 * is manager/owner-only. Sunday coverage is BU-wide (2026-07-24): a manager
 * may set the rota for ANY team, not just their own — see the dedicated
 * Sunday Coverage page. `canManageAnySundayRota` is deliberately not
 * team-scoped.
 */
const sundayRotaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.requireAuth] }, async (request) => {
    const q = request.query as { teamId?: string; from?: string; to?: string };
    // teamId omitted → BU-wide (the Sunday Coverage page); given → one team
    // (the older team-scoped rota sheet still works unchanged).
    return q.teamId ? listRotaForTeam(q.teamId, q.from, q.to) : listAllRota(q.from, q.to);
  });

  app.post<{ Body: { rotaDate?: string; personId?: string } }>(
    "/",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const { rotaDate, personId } = request.body ?? {};
      if (!rotaDate || !personId) throw badRequest("rotaDate and personId are required");
      if (!canManageAnySundayRota(actor)) {
        throw forbidden("only a manager may edit the Sunday rota");
      }
      const person = await findPersonById(personId);
      if (!person) throw badRequest("unknown person");
      if (!person.teamId) throw badRequest("person is not on a team");
      // The entry is attributed to the person's own team, derived server-side
      // — a manager rostering someone on another team can't misattribute it.
      const entry = await addRotaEntry(rotaDate, personId, person.teamId);
      publish({ type: "sunday-rota" });
      publish({ type: "capacity-ranking" });
      return entry;
    }
  );

  app.delete<{ Params: { id: string } }>("/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const entry = await findRotaEntryById(request.params.id);
    if (!entry) throw notFound("rota entry not found");
    if (!canManageAnySundayRota(actor)) {
      throw forbidden("only a manager may edit the Sunday rota");
    }
    await removeRotaEntry(entry.id);
    publish({ type: "sunday-rota" });
    publish({ type: "capacity-ranking" });
    return { ok: true };
  });
};

export default sundayRotaRoutes;
