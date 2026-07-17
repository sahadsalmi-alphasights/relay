import type { FastifyPluginAsync } from "fastify";
import { insertAuditLog } from "../repositories/auditLog";
import { createAngle, listAnglesByProject } from "../repositories/angles";
import {
  createAssignment,
  listAssignmentsByAngle,
  listAssignmentsByProject,
} from "../repositories/assignments";
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
import { needsCallsSoldUpdateToday, needsChaseClient } from "../rules/project";
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

/**
 * Big structural change — calls_sold, and "delivered vs. sold," are both
 * per-angle facts now, not per-project. Each is computed per angle and then
 * OR'd across the project's angles: correct even when angles disagree (e.g.
 * one angle fully sold, another not yet started) in a way that summing
 * project-wide totals would get wrong (a resolved angle's delivered count
 * could paper over a genuinely-lagging one, or vice versa). The one-angle
 * case collapses back to exactly the old per-project behavior.
 */
async function withProjectFlags(project: ProjectRow, now: Date) {
  const angles = await listAnglesByProject(project.id);
  let needsCallsSoldUpdate = false;
  let chaseClient = false;
  for (const angle of angles) {
    if (needsCallsSoldUpdateToday(angle.callsSoldUpdatedAt, now)) needsCallsSoldUpdate = true;
    const angleAssignments = await listAssignmentsByAngle(angle.id);
    const totalDelivered = angleAssignments.reduce((sum, a) => sum + a.delivered + a.customDelivered, 0);
    if (needsChaseClient(totalDelivered, angle.callsSold, angle.callsN)) chaseClient = true;
  }
  return { ...project, needsCallsSoldUpdate, chaseClient };
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
    return Promise.all(rows.map((p) => withProjectFlags(p, now)));
  });

  app.get<{ Params: { id: string } }>("/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const project = await findProjectById(request.params.id);
    if (!project) throw notFound("project not found");
    const assignments = await listAssignmentsByProject(project.id);
    const angles = await listAnglesByProject(project.id);
    return { project: await withProjectFlags(project, resolveNow(request)), assignments, angles };
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
      angles?: {
        name?: string;
        callsN?: number;
        goalTotal?: number;
        assignments?: { delivererId: string; goal: number; override?: { justification: string } }[];
      }[];
    };
  }>("/", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const body = request.body ?? {};
    if (!body.client || !body.projectType || !body.expertPool || !body.projectLink) {
      throw badRequest("client, projectType, expertPool, projectLink are required");
    }
    if (!isValidHttpUrl(body.projectLink)) {
      throw badRequest("projectLink must be a valid http(s) URL");
    }
    if (!PROJECT_TYPES.includes(body.projectType as ProjectType)) {
      throw badRequest("projectType must be one of Pitch, Due Diligence, Strategy");
    }
    // Big structural change — a project always has >=1 angle. A "simple"
    // project is just a project with one angle; there is no separate mode.
    const angleInputs = body.angles ?? [];
    if (angleInputs.length === 0) {
      throw badRequest("at least one angle is required");
    }
    const minCallsN = body.projectType === "Pitch" ? 0 : 1;
    for (const ang of angleInputs) {
      if (!ang.name || !ang.name.trim()) throw badRequest("each angle needs a name");
      if (ang.callsN === undefined || ang.callsN < minCallsN) {
        throw badRequest(`callsN must be >= ${minCallsN} for ${body.projectType}`);
      }
      if (!ang.goalTotal) throw badRequest("each angle needs a goalTotal");
    }

    const allAssignments = angleInputs.flatMap((ang) => ang.assignments ?? []);
    const project = await createProject({
      plId: actor.id,
      client: body.client,
      account: body.account,
      topic: body.topic,
      projectLink: body.projectLink,
      projectType: body.projectType,
      expertPool: body.expertPool,
      status: allAssignments.length > 0 ? "matched" : "open",
    });

    for (const ang of angleInputs) {
      const createdAngle = await createAngle(project.id, ang.name!.trim(), ang.callsN!, ang.goalTotal!);
      for (const a of ang.assignments ?? []) {
        await createAssignment(createdAngle.id, a.delivererId, a.goal);
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
      // §6 (built) — audit-log whenever the PL revises an angle's suggested goal downwards, before it's ever staffed.
      const suggested = suggestGoal(ang.callsN!, body.projectType as ProjectType);
      if (ang.goalTotal! < suggested) {
        await insertAuditLog({
          entityType: "angle",
          entityId: createdAngle.id,
          actorId: actor.id,
          action: "downward_goal_revision",
          oldValue: { suggestedGoal: suggested },
          newValue: { goalTotal: ang.goalTotal },
        });
      }
    }

    await insertAuditLog({ entityType: "project", entityId: project.id, actorId: actor.id, action: "create", newValue: body });
    await publishProjectChanged(project.id, [actor.id, ...allAssignments.map((a) => a.delivererId)]);
    if (allAssignments.length > 0) {
      publish({ type: "capacity-ranking" });
      // §9 (built) — "project assigned to you," one per newly staffed deliverer.
      for (const a of allAssignments) {
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
   *
   * Big structural change — assignments attach to an angle now. `angleId` is
   * only required in the body when the project has more than one angle; the
   * common (one-angle) case defaults to it automatically so adding someone
   * to a simple project doesn't get heavier.
   */
  app.post<{
    Params: { id: string };
    Body: { angleId?: string; delivererId?: string; goal?: number; override?: { justification: string } };
  }>("/:id/assignments", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const project = await findProjectById(request.params.id);
    if (!project) throw notFound("project not found");
    if (!canEditProjectFields(actor.id, project)) throw forbidden("only the PL may edit the team");
    if (!request.body?.delivererId || typeof request.body.goal !== "number") {
      throw badRequest("delivererId and goal are required");
    }

    const angles = await listAnglesByProject(project.id);
    let angleId = request.body.angleId;
    if (!angleId) {
      if (angles.length !== 1) throw badRequest("angleId is required when the project has more than one angle");
      angleId = angles[0].id;
    } else if (!angles.some((ang) => ang.id === angleId)) {
      throw badRequest("unknown angle for this project");
    }

    const angleAssignments = await listAssignmentsByAngle(angleId);
    if (angleAssignments.some((a) => a.delivererId === request.body.delivererId)) {
      throw badRequest("that person already has an assignment on this angle");
    }

    const created = await createAssignment(angleId, request.body.delivererId, request.body.goal);
    await insertAuditLog({
      entityType: "assignment",
      entityId: created.id,
      actorId: actor.id,
      action: "add_to_team",
      newValue: { delivererId: request.body.delivererId, goal: request.body.goal, angleId },
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
  });

  /**
   * Big structural change — add another angle to an already-created project.
   * PL-only, audit-logged. Starts unstaffed; the PL then uses "Edit team"
   * (above) against this new angle to assign deliverers to it.
   */
  app.post<{ Params: { id: string }; Body: { name?: string; callsN?: number; goalTotal?: number } }>(
    "/:id/angles",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const project = await findProjectById(request.params.id);
      if (!project) throw notFound("project not found");
      if (!canEditProjectFields(actor.id, project)) throw forbidden("only the PL may add angles");
      const body = request.body ?? {};
      if (!body.name || !body.name.trim()) throw badRequest("name is required");
      const minCallsN = project.projectType === "Pitch" ? 0 : 1;
      if (body.callsN === undefined || body.callsN < minCallsN) {
        throw badRequest(`callsN must be >= ${minCallsN} for ${project.projectType}`);
      }
      const goalTotal = body.goalTotal ?? suggestGoal(body.callsN, project.projectType as ProjectType);
      const created = await createAngle(project.id, body.name.trim(), body.callsN, goalTotal);
      await insertAuditLog({ entityType: "angle", entityId: created.id, actorId: actor.id, action: "create", newValue: body });
      await publishProjectChanged(project.id, [project.plId]);
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

      // Deliberate simplification: an open-pool project's claim always lands
      // on its first (earliest-created) angle. Multi-angle open-pool
      // projects aren't a described product flow yet -- if that becomes a
      // real scenario, accepting needs its own angle picker.
      const angles = await listAnglesByProject(claimed.id);
      const angle = angles[0];
      const assignment = await createAssignment(angle.id, actor.id, request.body?.goal ?? angle.goalTotal);
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
