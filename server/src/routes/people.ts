import type { FastifyPluginAsync } from "fastify";
import { insertAuditLog } from "../repositories/auditLog";
import {
  assignTeam,
  countOutstandingProfiles,
  findPersonById,
  listPeople,
  listPeopleByTeam,
  listUnassignedPeople,
  removeFromTeam,
  setGhostFlag,
  updateEveningCoverage,
  updateOutToLunch,
  updatePersonStatus,
} from "../repositories/people";
import {
  createPersonalNote,
  deletePersonalNote,
  findPersonalNoteById,
  listPersonalNotes,
  updatePersonalNoteBody,
} from "../repositories/personalNotes";
import { badRequest, forbidden, notFound } from "../errors";
import { canManageTeamRoster, canSetGhostFlag, canSetPersonStatus } from "../rules/permissions";
import { shouldWarnOnStatusChange } from "../rules/project";
import type { PersonStatus } from "../rules/types";
import { publish } from "../ws/hub";

const STATUSES: PersonStatus[] = ["Available", "On vacation", "Sick", "Offline"];

const peopleRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.requireAuth] }, async (request) => {
    const teamId = (request.query as { teamId?: string }).teamId;
    return teamId ? listPeopleByTeam(teamId) : listPeople();
  });

  // People not yet on any team — candidates a manager can add to their own team (§7b).
  app.get("/unassigned", { preHandler: [app.requireAuth] }, async () => listUnassignedPeople());

  // §7b — a manager adds an existing, currently-unassigned person to their own team.
  // There is no "invite by name" — people only exist once they've logged in via SSO/DEV_AUTH.
  app.post<{ Params: { id: string }; Body: { teamId?: string } }>(
    "/:id/assign-team",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const target = await findPersonById(request.params.id);
      if (!target) throw notFound("unknown person");
      if (target.teamId) throw badRequest("person already belongs to a team");
      const teamId = request.body?.teamId ?? actor.teamId;
      if (!teamId) throw badRequest("teamId is required");
      if (!canManageTeamRoster(actor, { teamId })) {
        throw forbidden("only a manager may add members to their own team");
      }
      const updated = await assignTeam(target.id, teamId, false);
      await insertAuditLog({
        entityType: "person",
        entityId: target.id,
        actorId: actor.id,
        action: "assign_team",
        newValue: { teamId },
      });
      return updated;
    }
  );

  // §7b — a manager removes a member from their own team (they become unassigned, re-onboard via §7a).
  app.post<{ Params: { id: string } }>(
    "/:id/remove-from-team",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const target = await findPersonById(request.params.id);
      if (!target) throw notFound("unknown person");
      if (!target.teamId || !canManageTeamRoster(actor, { teamId: target.teamId })) {
        throw forbidden("only a manager may remove members from their own team");
      }
      const updated = await removeFromTeam(target.id);
      await insertAuditLog({
        entityType: "person",
        entityId: target.id,
        actorId: actor.id,
        action: "remove_from_team",
        oldValue: { teamId: target.teamId },
      });
      return updated;
    }
  );

  // §7b — a manager may set status only for their own team; §4 Rule 1 warning on outstanding work.
  app.patch<{ Params: { id: string }; Body: { status: PersonStatus } }>(
    "/:id/status",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const target = await findPersonById(request.params.id);
      if (!target) throw notFound("unknown person");
      if (!STATUSES.includes(request.body?.status)) throw badRequest("invalid status");
      if (!canSetPersonStatus(actor, target)) {
        throw forbidden("only a manager may set status for their own team");
      }

      const outstanding = await countOutstandingProfiles(target.id);
      const warn = shouldWarnOnStatusChange(request.body.status, outstanding);
      const updated = await updatePersonStatus(target.id, request.body.status);
      await insertAuditLog({
        entityType: "person",
        entityId: target.id,
        actorId: actor.id,
        action: "set_status",
        oldValue: { status: target.status },
        newValue: { status: request.body.status },
      });
      // §4 Rule 1 — status gates eligibility org-wide; /people is fetched unscoped by everyone already.
      publish({ type: "people" });
      publish({ type: "capacity-ranking" });
      return { person: updated, warning: warn ? { outstandingProfiles: outstanding } : null };
    }
  );

  /**
   * "Invisible competition" — manager sets/unsets a person's ghost flag,
   * same team-scoped rule as every other roster action (canManageTeamRoster).
   * Server-enforced, not just hidden in the UI. Easily reversible: this is
   * the only write path for is_ghost, in either direction.
   */
  app.patch<{ Params: { id: string }; Body: { isGhost?: boolean } }>(
    "/:id/ghost",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const target = await findPersonById(request.params.id);
      if (!target) throw notFound("unknown person");
      if (!target.teamId || !canSetGhostFlag(actor, { teamId: target.teamId })) {
        throw forbidden("your group cannot set ghost status for this team");
      }
      if (typeof request.body?.isGhost !== "boolean") throw badRequest("isGhost must be a boolean");
      const updated = await setGhostFlag(target.id, request.body.isGhost);
      await insertAuditLog({
        entityType: "person",
        entityId: target.id,
        actorId: actor.id,
        action: "set_ghost",
        oldValue: { isGhost: target.isGhost },
        newValue: { isGhost: request.body.isGhost },
      });
      publish({ type: "people" });
      publish({ type: "capacity-ranking" });
      return updated;
    }
  );

  // §4 Rule 3 / §7b — self-serve only. There is deliberately no equivalent route for setting someone else's.
  app.patch<{ Body: { eveningCoverage: boolean } }>(
    "/me/evening-coverage",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      if (typeof request.body?.eveningCoverage !== "boolean") {
        throw badRequest("eveningCoverage must be a boolean");
      }
      const updated = await updateEveningCoverage(actor.id, request.body.eveningCoverage);
      publish({ type: "people" });
      publish({ type: "capacity-ranking" });
      return updated;
    }
  );

  // "Out to Lunch" — self-serve only, exactly like evening coverage: while
  // on, the person is ineligible for new allocations (existing work stays)
  // and shows as a red "Lunch" chip on the Capacity Ranking.
  app.patch<{ Body: { outToLunch: boolean } }>(
    "/me/lunch",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      if (typeof request.body?.outToLunch !== "boolean") {
        throw badRequest("outToLunch must be a boolean");
      }
      const updated = await updateOutToLunch(actor.id, request.body.outToLunch);
      publish({ type: "people" });
      publish({ type: "capacity-ranking" });
      return updated;
    }
  );

  // Personal reminders — the "Admin" section of the notes to-do box. Strictly
  // self-serve: every route operates only on the caller's own rows (a note's
  // person_id must equal the actor), so one person can never read or touch
  // another's reminders. Mutations are audit-logged like every other write.
  app.get("/me/notes", { preHandler: [app.requireAuth] }, async (request) => {
    return listPersonalNotes(request.actor!.id);
  });

  app.post<{ Body: { body?: string } }>("/me/notes", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    if (!request.body?.body?.trim()) throw badRequest("body is required");
    const created = await createPersonalNote(actor.id, request.body.body.trim());
    await insertAuditLog({
      entityType: "personal_note",
      entityId: created.id,
      actorId: actor.id,
      action: "personal_note_created",
      newValue: { body: created.body },
    });
    return created;
  });

  app.patch<{ Params: { id: string }; Body: { body?: string } }>(
    "/me/notes/:id",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const note = await findPersonalNoteById(request.params.id);
      if (!note || note.personId !== actor.id) throw notFound("reminder not found");
      if (!request.body?.body?.trim()) throw badRequest("body is required");
      const updated = await updatePersonalNoteBody(note.id, request.body.body.trim());
      await insertAuditLog({
        entityType: "personal_note",
        entityId: note.id,
        actorId: actor.id,
        action: "personal_note_edited",
        oldValue: { body: note.body },
        newValue: { body: updated.body },
      });
      return updated;
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/me/notes/:id",
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const actor = request.actor!;
      const note = await findPersonalNoteById(request.params.id);
      if (!note || note.personId !== actor.id) throw notFound("reminder not found");
      await deletePersonalNote(note.id);
      await insertAuditLog({
        entityType: "personal_note",
        entityId: note.id,
        actorId: actor.id,
        action: "personal_note_deleted",
        oldValue: { body: note.body },
      });
      reply.code(204);
    }
  );
};

export default peopleRoutes;
