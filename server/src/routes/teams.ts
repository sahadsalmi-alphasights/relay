import type { FastifyPluginAsync } from "fastify";
import { badRequest, conflict, notFound } from "../errors";
import { insertAuditLog } from "../repositories/auditLog";
import { findPersonById, listPeopleByTeam, setManagerFlag } from "../repositories/people";
import { createTeam, deleteTeam, findTeamById, listTeams, renameTeam } from "../repositories/teams";
import { publish } from "../ws/hub";

/**
 * GET stays open to everyone (onboarding's "join a team" needs it). The
 * management routes below are User-Management surface — owner-only, all
 * audit-logged, all pushed live over the socket.
 */
const teamsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.requireAuth] }, async () => listTeams());

  app.post<{ Body: { name?: string } }>("/", { preHandler: [app.requireOwner] }, async (request) => {
    const name = request.body?.name?.trim();
    if (!name) throw badRequest("team name is required");
    const team = await createTeam(name);
    await insertAuditLog({
      entityType: "team",
      entityId: team.id,
      actorId: request.actor!.id,
      action: "create_team",
      newValue: { name },
    });
    publish({ type: "people" });
    return team;
  });

  app.patch<{ Params: { id: string }; Body: { name?: string } }>(
    "/:id",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const team = await findTeamById(request.params.id);
      if (!team) throw notFound("unknown team");
      const name = request.body?.name?.trim();
      if (!name) throw badRequest("team name is required");
      const updated = await renameTeam(team.id, name);
      await insertAuditLog({
        entityType: "team",
        entityId: team.id,
        actorId: request.actor!.id,
        action: "rename_team",
        oldValue: { name: team.name },
        newValue: { name },
      });
      publish({ type: "people" });
      return updated;
    }
  );

  /**
   * Assign "the" manager of a team: promotes the picked member and demotes
   * every other manager on that team (targeted is_manager flip — owner flags
   * are never touched, so an owner on the team keeps owner powers either
   * way). personId null demotes all — a team can deliberately have none.
   */
  app.patch<{ Params: { id: string }; Body: { personId?: string | null } }>(
    "/:id/manager",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const team = await findTeamById(request.params.id);
      if (!team) throw notFound("unknown team");
      const personId = request.body?.personId ?? null;

      if (personId) {
        const person = await findPersonById(personId);
        if (!person) throw notFound("unknown person");
        if (person.teamId !== team.id) throw badRequest("that person is not on this team — move them there first");
        if (person.deactivatedAt) throw badRequest("that account is deactivated");
      }

      const members = await listPeopleByTeam(team.id);
      const previousManagers = members.filter((m) => m.isManager).map((m) => m.id);
      for (const m of members) {
        if (personId && m.id === personId && !m.isManager) await setManagerFlag(m.id, true);
        else if (m.id !== personId && m.isManager) await setManagerFlag(m.id, false);
      }

      await insertAuditLog({
        entityType: "team",
        entityId: team.id,
        actorId: request.actor!.id,
        action: "assign_manager",
        oldValue: { managerIds: previousManagers },
        newValue: { managerId: personId },
      });
      publish({ type: "people" });
      return { ok: true };
    }
  );

  /** Deletable only when empty — members must be moved first, so nothing dangles. */
  app.delete<{ Params: { id: string } }>("/:id", { preHandler: [app.requireOwner] }, async (request) => {
    const team = await findTeamById(request.params.id);
    if (!team) throw notFound("unknown team");
    const members = await listPeopleByTeam(team.id);
    if (members.length > 0) {
      throw conflict(
        `${team.name} still has ${members.length} member${members.length === 1 ? "" : "s"} — move them to another team first`
      );
    }
    try {
      await deleteTeam(team.id);
    } catch (err) {
      if ((err as { code?: string }).code === "23503") {
        throw conflict(`${team.name} has history (rota entries, …) and cannot be deleted`);
      }
      throw err;
    }
    await insertAuditLog({
      entityType: "team",
      entityId: team.id,
      actorId: request.actor!.id,
      action: "delete_team",
      oldValue: { name: team.name },
      newValue: null,
    });
    publish({ type: "people" });
    return { ok: true };
  });
};

export default teamsRoutes;
