import type { FastifyPluginAsync } from "fastify";
import { insertAuditLog } from "../repositories/auditLog";
import { createAssignment, listAssignmentsByProject } from "../repositories/assignments";
import { listUnresolvedForProject } from "../repositories/goalChangeRequests";
import { createNote, listNotesForProject } from "../repositories/notes";
import {
  claimOpenProject,
  createProject,
  findProjectById,
  listProjects,
  setArchived,
  updateProjectFields,
  type ProjectFilter,
  type ProjectRow,
} from "../repositories/projects";
import { listPeopleByTeam } from "../repositories/people";
import { sundayRotaPersonIdsForDate, listAvailableCandidatesWithAssignments } from "../services/candidates";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { isEligible } from "../rules/eligibility";
import { autoMatch, rankCandidates } from "../rules/matching";
import { resolveNow } from "../lib/requestTime";
import { canArchiveProject, canEditProjectFields } from "../rules/permissions";
import { needsCallsSoldUpdateToday } from "../rules/project";
import { suggestGoal, suggestStaffing } from "../rules/suggestedGoal";
import { dubaiDateKey } from "../rules/time";
import type { ProjectType } from "../rules/types";
import { isValidHttpUrl } from "../rules/url";
import { notify } from "../services/notify";
import { publish } from "../ws/hub";
import { projectRecipientIds } from "../ws/recipients";

const PROJECT_TYPES: ProjectType[] = ["Pitch", "Due Diligence", "Strategy"];

/** §11 step 5 — every write to a project (or its assignments) notifies its PL + assignees + their teammates. */
async function publishProjectChanged(projectId: string, involvedPersonIds: string[]): Promise<void> {
  const recipients = await projectRecipientIds(involvedPersonIds);
  publish({ type: "project", projectId }, recipients);
}

/**
 * §4/§9 (built) — computed live at the moment the project actually falls
 * open, not trusted from whatever /intake/match saw earlier: eligibility
 * (status/rota/evening-coverage) can change in the gap between the two calls.
 */
async function notifyEligibleOfOpenProject(project: ProjectRow, now: Date): Promise<void> {
  const rotaSet = await sundayRotaPersonIdsForDate(dubaiDateKey(now));
  const candidates = await listAvailableCandidatesWithAssignments();
  for (const candidate of candidates) {
    const elig = isEligible(candidate, { now, sundayRotaPersonIds: rotaSet });
    if (!elig.eligible) continue;
    await notify({
      personId: candidate.id,
      type: "open_pool",
      title: "Project up for grabs",
      body: `${project.client} has no one staffed — first to accept takes it.`,
      entityType: "project",
      entityId: project.id,
    });
  }
}

function withCallsSoldFlag(project: ProjectRow, now: Date) {
  return { ...project, needsCallsSoldUpdate: needsCallsSoldUpdateToday(project.callsSoldUpdatedAt, now) };
}

const projectsRoutes: FastifyPluginAsync = async (app) => {
  // §8 scope toggle — "mine" is just the actor; "team" is every teammate (actor included).
  // `role` picks which relationship to the project: leading (pl_id) or delivering (an assignment).
  app.get("/", { preHandler: [app.requireAuth] }, async (request) => {
    const q = request.query as { role?: string; scope?: string; status?: string; archived?: string };
    const actor = request.actor!;
    const filter: ProjectFilter = {
      status: q.status as ProjectFilter["status"],
      archived: q.archived === "true" ? true : q.archived === "false" ? false : undefined,
    };

    let teamIds: string[] | null = null;
    if (q.scope === "team" && actor.teamId) {
      teamIds = (await listPeopleByTeam(actor.teamId)).map((p) => p.id);
    }

    if (q.role === "leading") {
      if (teamIds) filter.plIdIn = teamIds;
      else filter.plId = actor.id;
    } else if (q.role === "delivering") {
      if (teamIds) filter.delivererIdIn = teamIds;
      else filter.delivererId = actor.id;
    }

    const rows = await listProjects(filter);
    const now = resolveNow(request);
    return rows.map((p) => withCallsSoldFlag(p, now));
  });

  app.get<{ Params: { id: string } }>("/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const project = await findProjectById(request.params.id);
    if (!project) throw notFound("project not found");
    const assignments = await listAssignmentsByProject(project.id);
    return { project: withCallsSoldFlag(project, resolveNow(request)), assignments };
  });

  // §5a/§5b (domain change 4) — pure computation, no DB write. Intake wizard
  // step 2. Project type changes the formula: a Pitch may have N=0 (no calls
  // agreed yet, a preview list); every other type still needs N>=1.
  app.post<{ Body: { callsN?: number; projectType?: string } }>(
    "/intake/suggest",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const callsN = request.body?.callsN;
      const projectType = request.body?.projectType as ProjectType | undefined;
      if (!projectType || !PROJECT_TYPES.includes(projectType)) {
        throw badRequest("projectType must be one of Pitch, Due Diligence, Strategy");
      }
      const minCallsN = projectType === "Pitch" ? 0 : 1;
      if (!Number.isInteger(callsN) || (callsN as number) < minCallsN) {
        throw badRequest(`callsN must be an integer >= ${minCallsN}`);
      }
      return {
        goal: suggestGoal(callsN as number, projectType),
        staffing: suggestStaffing(callsN as number, projectType),
      };
    }
  );

  // §5d — auto-match reveal. Intake wizard step 3 (read-only; nothing is persisted here).
  // Uses the same autoMatch() the rules engine is unit-tested against, so
  // "how many get picked" has one authoritative implementation instead of
  // being re-derived (and potentially drifting) in the client.
  app.post<{ Body: { staffCount?: number } }>("/intake/match", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const rawStaffCount = request.body?.staffCount;
    if (!Number.isInteger(rawStaffCount) || (rawStaffCount as number) < 1) {
      throw badRequest("staffCount must be a positive integer");
    }
    const staffCount = rawStaffCount as number;
    const now = resolveNow(request);
    const rotaSet = await sundayRotaPersonIdsForDate(dubaiDateKey(now));
    const candidates = await listAvailableCandidatesWithAssignments();
    const context = {
      now,
      sundayRotaPersonIds: rotaSet,
      plPracticeArea: actor.practiceArea ?? "",
    };
    const ranked = rankCandidates(candidates, context);
    const { assigned: picked, projectStatus } = autoMatch(candidates, context, staffCount);
    return { ranked, picked, projectStatus, staffCount };
  });

  app.post<{
    Body: {
      client?: string;
      account?: string;
      topic?: string;
      projectLink?: string;
      projectType?: string;
      expertPool?: string;
      callsN?: number;
      goalTotal?: number;
      assignments?: { delivererId: string; goal: number; override?: { justification: string } }[];
    };
  }>("/", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const body = request.body ?? {};
    if (
      !body.client ||
      !body.projectType ||
      !body.expertPool ||
      body.callsN === undefined ||
      !body.goalTotal ||
      !body.projectLink
    ) {
      throw badRequest("client, projectType, expertPool, callsN, goalTotal, projectLink are required");
    }
    if (!isValidHttpUrl(body.projectLink)) {
      throw badRequest("projectLink must be a valid http(s) URL");
    }
    if (!PROJECT_TYPES.includes(body.projectType as ProjectType)) {
      throw badRequest("projectType must be one of Pitch, Due Diligence, Strategy");
    }
    // §5a (domain change 4) — only a Pitch may have N=0 (no calls agreed yet).
    const minCallsN = body.projectType === "Pitch" ? 0 : 1;
    if (body.callsN < minCallsN) {
      throw badRequest(`callsN must be >= ${minCallsN} for ${body.projectType}`);
    }
    const assignments = body.assignments ?? [];
    const project = await createProject({
      plId: actor.id,
      client: body.client,
      account: body.account,
      topic: body.topic,
      projectLink: body.projectLink,
      projectType: body.projectType,
      expertPool: body.expertPool,
      callsN: body.callsN,
      goalTotal: body.goalTotal,
      status: assignments.length > 0 ? "matched" : "open",
    });
    for (const a of assignments) {
      await createAssignment(project.id, a.delivererId, a.goal);
      // §6 (built) — an override (the PL picked someone other than who the
      // ranking/auto-match suggested) always carries a justification; log it
      // to the audit trail. Never notify anyone about the override itself —
      // the ordinary "assigned" notification below still reaches the person.
      if (a.override?.justification) {
        await insertAuditLog({
          entityType: "assignment",
          entityId: project.id,
          actorId: actor.id,
          action: "manual_override",
          newValue: { pickedInstead: a.delivererId, justification: a.override.justification },
        });
      }
    }
    // §6 (built) — audit-log whenever the PL revises the suggested goal downwards, before it's ever staffed.
    const suggested = suggestGoal(body.callsN, body.projectType as ProjectType);
    if (body.goalTotal < suggested) {
      await insertAuditLog({
        entityType: "project",
        entityId: project.id,
        actorId: actor.id,
        action: "downward_goal_revision",
        oldValue: { suggestedGoal: suggested },
        newValue: { goalTotal: body.goalTotal },
      });
    }
    await insertAuditLog({ entityType: "project", entityId: project.id, actorId: actor.id, action: "create", newValue: body });
    await publishProjectChanged(project.id, [actor.id, ...assignments.map((a) => a.delivererId)]);
    if (assignments.length > 0) {
      publish({ type: "capacity-ranking" });
      // §9 (built) — "project assigned to you," one per newly staffed deliverer.
      for (const a of assignments) {
        await notify({
          personId: a.delivererId,
          type: "assigned",
          title: "New project assigned to you",
          body: `${project.client} — you've been staffed with a goal of ${a.goal}.`,
          entityType: "project",
          entityId: project.id,
        });
      }
    } else {
      publish({ type: "open-pool" });
      // §9 (built) — zero eligible people at staffing time -> the true last
      // resort (§4): notify everyone who's currently eligible to claim it.
      await notifyEligibleOfOpenProject(project, resolveNow(request));
    }
    return findProjectById(project.id);
  });

  /**
   * §6/§3 (built) — "Edit team": add a new deliverer to an already-created
   * project, PL-only. Same override/justification handling as swap and
   * creation-time staffing (§6): an override never triggers a notification
   * about itself, only the ordinary "assigned" one for the person landed on.
   */
  app.post<{ Params: { id: string }; Body: { delivererId?: string; goal?: number; override?: { justification: string } } }>(
    "/:id/assignments",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const project = await findProjectById(request.params.id);
      if (!project) throw notFound("project not found");
      if (!canEditProjectFields(actor.id, project)) throw forbidden("only the PL may edit the team");
      if (!request.body?.delivererId || typeof request.body.goal !== "number") {
        throw badRequest("delivererId and goal are required");
      }

      const projectAssignments = await listAssignmentsByProject(project.id);
      if (projectAssignments.some((a) => a.delivererId === request.body.delivererId)) {
        throw badRequest("that person already has an assignment on this project");
      }

      const created = await createAssignment(project.id, request.body.delivererId, request.body.goal);
      await insertAuditLog({
        entityType: "assignment",
        entityId: created.id,
        actorId: actor.id,
        action: "add_to_team",
        newValue: { delivererId: request.body.delivererId, goal: request.body.goal },
      });
      if (request.body.override?.justification) {
        await insertAuditLog({
          entityType: "assignment",
          entityId: created.id,
          actorId: actor.id,
          action: "manual_override",
          newValue: { pickedInstead: request.body.delivererId, justification: request.body.override.justification },
        });
      }
      await publishProjectChanged(project.id, [project.plId, request.body.delivererId]);
      publish({ type: "capacity-ranking" });
      await notify({
        personId: request.body.delivererId,
        type: "assigned",
        title: "New project assigned to you",
        body: `${project.client} — you've been staffed with a goal of ${created.goal}.`,
        entityType: "project",
        entityId: project.id,
      });
      return created;
    }
  );

  // §5e — only the PL may edit project fields.
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/:id",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const project = await findProjectById(request.params.id);
      if (!project) throw notFound("project not found");
      if (!canEditProjectFields(actor.id, project)) throw forbidden("only the PL may edit this project");
      // projectLink is required (bug fix) -- a PATCH can't be used to clear it,
      // and whatever it's changed to must still be a valid http(s) URL.
      if (request.body && "projectLink" in request.body) {
        const link = request.body.projectLink;
        if (typeof link !== "string" || !isValidHttpUrl(link)) {
          throw badRequest("projectLink must be a valid http(s) URL");
        }
      }
      const updated = await updateProjectFields(project.id, request.body ?? {});
      await insertAuditLog({
        entityType: "project",
        entityId: project.id,
        actorId: actor.id,
        action: "update_fields",
        oldValue: project,
        newValue: request.body,
      });
      const assignments = await listAssignmentsByProject(project.id);
      await publishProjectChanged(project.id, [project.plId, ...assignments.map((a) => a.delivererId)]);
      // §5c — only expert_pool actually feeds load (assignment.goal does, project.goalTotal doesn't);
      // don't broadcast an org-wide ranking refresh for edits (like calls_sold) that can't move anyone's load.
      if (request.body && "expertPool" in request.body) publish({ type: "capacity-ranking" });
      return updated;
    }
  );

  // §6/§8 — stage advance/back moved to POST /assignments/:id/stage/advance
  // and /back: stage is per-deliverer now, not per-project (domain change 8).

  app.post<{ Params: { id: string } }>("/:id/archive", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const project = await findProjectById(request.params.id);
    if (!project) throw notFound("project not found");
    if (!canArchiveProject(actor.id, project)) throw forbidden("only the PL may archive this project");
    const updated = await setArchived(project.id, true);
    await insertAuditLog({ entityType: "project", entityId: project.id, actorId: actor.id, action: "archive" });
    const assignments = await listAssignmentsByProject(project.id);
    await publishProjectChanged(project.id, [project.plId, ...assignments.map((a) => a.delivererId)]);
    publish({ type: "capacity-ranking" });
    return updated;
  });

  app.post<{ Params: { id: string } }>("/:id/resurface", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const project = await findProjectById(request.params.id);
    if (!project) throw notFound("project not found");
    if (!canArchiveProject(actor.id, project)) throw forbidden("only the PL may resurface this project");
    const updated = await setArchived(project.id, false);
    await insertAuditLog({ entityType: "project", entityId: project.id, actorId: actor.id, action: "resurface" });
    const assignments = await listAssignmentsByProject(project.id);
    await publishProjectChanged(project.id, [project.plId, ...assignments.map((a) => a.delivererId)]);
    publish({ type: "capacity-ranking" });
    return updated;
  });

  // §4 — open pool, first-commit-wins claim. No PL/manager gate: any currently-eligible person may accept.
  app.post<{ Params: { id: string }; Body: { goal?: number } }>(
    "/:id/accept",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const project = await findProjectById(request.params.id);
      if (!project) throw notFound("project not found");
      if (project.status !== "open") throw badRequest("project is not open");

      const now = resolveNow(request);
      const rotaSet = await sundayRotaPersonIdsForDate(dubaiDateKey(now));
      const elig = isEligible(
        { id: actor.id, status: actor.status, eveningCoverage: actor.eveningCoverage },
        { now, sundayRotaPersonIds: rotaSet }
      );
      if (!elig.eligible) throw forbidden(`not eligible right now: ${elig.reason}`);

      const claimed = await claimOpenProject(project.id);
      if (!claimed) throw conflict("already claimed by someone else");

      const assignment = await createAssignment(claimed.id, actor.id, request.body?.goal ?? claimed.goalTotal);
      await insertAuditLog({ entityType: "project", entityId: claimed.id, actorId: actor.id, action: "accept_open" });
      await publishProjectChanged(claimed.id, [claimed.plId, actor.id]);
      // §4 first-commit-wins — everyone else's open pool must drop this immediately.
      publish({ type: "open-pool" });
      publish({ type: "capacity-ranking" });
      return { project: claimed, assignment };
    }
  );

  app.post<{ Params: { id: string }; Body: { body?: string; isPublic?: boolean } }>(
    "/:id/notes",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const project = await findProjectById(request.params.id);
      if (!project) throw notFound("project not found");
      if (!request.body?.body) throw badRequest("body is required");
      const authorRole = project.plId === actor.id ? "PL" : "Delivery";
      return createNote({
        projectId: project.id,
        authorId: actor.id,
        authorRole,
        body: request.body.body,
        isPublic: request.body.isPublic ?? true,
      });
    }
  );

  app.get<{ Params: { id: string } }>("/:id/notes", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const project = await findProjectById(request.params.id);
    if (!project) throw notFound("project not found");
    return listNotesForProject(project.id, actor.id);
  });

  // §8.1 — pending goal-change requests, for the PL board's badge + resolve banner.
  app.get<{ Params: { id: string } }>(
    "/:id/goal-change-requests",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const project = await findProjectById(request.params.id);
      if (!project) throw notFound("project not found");
      if (!canEditProjectFields(actor.id, project)) throw forbidden("only the PL may view pending goal change requests");
      return listUnresolvedForProject(project.id);
    }
  );
};

export default projectsRoutes;
