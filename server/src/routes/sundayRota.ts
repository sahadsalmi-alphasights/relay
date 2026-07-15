import type { FastifyPluginAsync } from "fastify";
import { findPersonById } from "../repositories/people";
import { addRotaEntry, findRotaEntryById, listRotaForTeam, removeRotaEntry } from "../repositories/sundayRota";
import { badRequest, forbidden, notFound } from "../errors";
import { canEditSundayRota } from "../rules/permissions";
import { publish } from "../ws/hub";

/** §4 Rule 2 — a schedule, not a preference. Read is open to the team; only a manager may write. */
const sundayRotaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.requireAuth] }, async (request) => {
    const q = request.query as { teamId?: string; from?: string; to?: string };
    if (!q.teamId) throw badRequest("teamId is required");
    return listRotaForTeam(q.teamId, q.from, q.to);
  });

  app.post<{ Body: { rotaDate?: string; personId?: string; teamId?: string } }>(
    "/",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const { rotaDate, personId, teamId } = request.body ?? {};
      if (!rotaDate || !personId || !teamId) throw badRequest("rotaDate, personId, teamId are required");
      if (!canEditSundayRota(actor, { teamId })) {
        throw forbidden("only a manager may edit their own team's rota");
      }
      const person = await findPersonById(personId);
      if (!person || person.teamId !== teamId) throw badRequest("person is not a member of that team");
      const entry = await addRotaEntry(rotaDate, personId, teamId);
      // §4 Rule 2 — the rota gates Sunday eligibility org-wide; ranking must re-check it live.
      publish({ type: "sunday-rota" });
      publish({ type: "capacity-ranking" });
      return entry;
    }
  );

  app.delete<{ Params: { id: string } }>("/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const entry = await findRotaEntryById(request.params.id);
    if (!entry) throw notFound("rota entry not found");
    if (!canEditSundayRota(actor, { teamId: entry.teamId })) {
      throw forbidden("only a manager may edit their own team's rota");
    }
    await removeRotaEntry(entry.id);
    publish({ type: "sunday-rota" });
    publish({ type: "capacity-ranking" });
    return { ok: true };
  });
};

export default sundayRotaRoutes;
