import type { FastifyPluginAsync } from "fastify";
import { withTransaction } from "../db";
import { insertAuditLog } from "../repositories/auditLog";
import { activateProjectIfFullyStaffed, claimAngleSeat, createAngle, listAnglesByProject } from "../repositories/angles";
import {
  createAssignment,
  listAssignmentsByAngle,
  listAssignmentsByProject,
} from "../repositories/assignments";
import { listUnresolvedForProject } from "../repositories/goalChangeRequests";
import { createNote, listNotesForProject } from "../repositories/notes";
import {
  archiveProject,
  createProject,
  findProjectById,
  listProjects,
  resurfaceProject,
  softDeleteProject,
  updateProjectFields,
  type ProjectFilter,
  type ProjectRow,
} from "../repositories/projects";
import { countAssignmentsForAngle, seatTargetForAngle } from "../repositories/angles";
import { listPeopleByTeam } from "../repositories/people";
import { sundayRotaPersonIdsForDate, listAvailableCandidatesWithAssignments } from "../services/candidates";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { isEligible } from "../rules/eligibility";
import { allocateAcrossAngles, applyFirstDeliverableBlock, rankCandidates } from "../rules/matching";
import { resolveNow } from "../lib/requestTime";
import { canArchiveProject, canEditProjectFields } from "../rules/permissions";
import { isProjectLifecycleQuiet, needsCallsSoldUpdateToday, needsChaseClient } from "../rules/project";
import { suggestGoal, suggestStaffing } from "../rules/suggestedGoal";
import { dubaiDateKey, dubaiHour } from "../rules/time";
import type { ProjectType } from "../rules/types";
import { isValidHttpUrl } from "../rules/url";
import { notifyBroadcastRecipients } from "../services/broadcast";
import { notify } from "../services/notify";
import { publish } from "../ws/hub";
import { projectRecipientIds } from "../ws/recipients";

const PROJECT_TYPES: ProjectType[] = ["Pitch", "Due Diligence", "Strategy"];
const CLIENT_ENTITIES = [1, 2, 3, 4, 5];

/** §11 step 5 — every write to a project (or its assignments) notifies its PL + assignees + their teammates. */
async function publishProjectChanged(projectId: string, involvedPersonIds: string[]): Promise<void> {
  const recipients = await projectRecipientIds(involvedPersonIds);
  publish({ type: "project", projectId }, recipients);
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
  // Project lifecycle — archived projects go quiet: never asked about in the
  // morning calls-sold dialog, never flagged to chase the client. Skip the
  // per-angle work entirely rather than compute-then-hide, since neither
  // flag means anything for a project nobody's working.
  if (isProjectLifecycleQuiet(project.status)) {
    return { ...project, needsCallsSoldUpdate: false, chaseClient: false };
  }
  const angles = await listAnglesByProject(project.id);
  let needsCallsSoldUpdate = false;
  let chaseClient = false;
  for (const angle of angles) {
    if (needsCallsSoldUpdateToday(angle.callsSoldUpdatedAt, now)) needsCallsSoldUpdate = true;
    const angleAssignments = await listAssignmentsByAngle(angle.id);
    // "Invisible competition" — the ghost is the competition, not extra
    // capacity: its delivered never counts toward this flag, same as it
    // never counts toward the goal/delivered roll-ups on the client.
    const totalDelivered = angleAssignments
      .filter((a) => !a.isGhost)
      .reduce((sum, a) => sum + a.delivered + a.customDelivered, 0);
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

  /**
   * Morning calls-sold dialog — the actor's own led active projects that
   * need today's update. Always scoped to "mine": this is a personal daily
   * task, not something Team view surfaces on someone else's behalf. Open
   * (never-staffed) and archived projects are never "due" — archived by
   * definition (see isProjectLifecycleQuiet), open because there's no one to
   * chase calls sold for yet. (Batch S removed 'idle' and, with it, this
   * route's old "parked" bucket — there's no third status left to bucket.)
   */
  app.get("/calls-sold-due", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const now = resolveNow(request);
    const projects = await listProjects({ plId: actor.id, archived: false });

    const due: {
      id: string;
      client: string;
      topic: string | null;
      angles: { id: string; name: string; callsN: number; callsSold: number }[];
    }[] = [];

    for (const project of projects) {
      if (project.status !== "active") continue;

      const angles = await listAnglesByProject(project.id);
      const stale = angles.filter((a) => needsCallsSoldUpdateToday(a.callsSoldUpdatedAt, now));
      if (stale.length > 0) {
        due.push({
          id: project.id,
          client: project.client,
          topic: project.topic,
          angles: stale.map((a) => ({ id: a.id, name: a.name, callsN: a.callsN, callsSold: a.callsSold })),
        });
      }
    }

    return { due };
  });

  app.get<{ Params: { id: string } }>("/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const project = await findProjectById(request.params.id);
    if (!project) throw notFound("project not found");
    const assignments = await listAssignmentsByProject(project.id);
    const angles = await listAnglesByProject(project.id);
    // Batch S, item 4 — notes were already persisted and readable (via the
    // dedicated Notes sheet), just not on the card itself. Folding them into
    // the one detail fetch both boards already make per card is what
    // actually surfaces them there; reuses listNotesForProject() (same
    // privacy filter the sheet already relies on) rather than a new query.
    const notes = await listNotesForProject(project.id, actor.id);
    return { project: await withProjectFlags(project, resolveNow(request)), assignments, angles, notes };
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

  /**
   * §5d — auto-match reveal. Intake wizard step 3 (read-only; nothing is
   * persisted here).
   *
   * CHANGE 1 — ONE call covering every angle against ONE candidate snapshot,
   * not one call per angle. The old per-angle Promise.all from the client
   * was blind to what other angles picked (nothing had been written to the
   * DB yet to shift anyone's load between calls), so every angle got
   * near-identical top-N suggestions. rankCandidates() itself is unchanged;
   * allocateAcrossAngles() is what fills angle-by-angle without replacement,
   * reusing already-placed people only once the eligible pool is exhausted.
   *
   * CHANGE 2 — applyFirstDeliverableBlock() layers the new auto-assign-time
   * rule on top of rankCandidates()'s output before allocation ever sees it,
   * so a blocked person is never silently auto-picked but still appears in
   * `ranked` (ineligible, with a reason) for the PL to see and override.
   */
  app.post<{ Body: { angles?: { key?: string; staffCount?: number }[] } }>(
    "/intake/match",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const angleInputs = request.body?.angles ?? [];
      if (angleInputs.length === 0) throw badRequest("at least one angle is required");
      for (const a of angleInputs) {
        if (!a.key || !Number.isInteger(a.staffCount) || (a.staffCount as number) < 1) {
          throw badRequest("each angle needs a key and a positive integer staffCount");
        }
      }
      const now = resolveNow(request);
      const hour = dubaiHour(now);
      const rotaSet = await sundayRotaPersonIdsForDate(dubaiDateKey(now));
      const candidates = await listAvailableCandidatesWithAssignments();
      const context = {
        now,
        sundayRotaPersonIds: rotaSet,
        plPracticeArea: actor.practiceArea ?? "",
      };
      const ranked = rankCandidates(candidates, context);
      const blocked = applyFirstDeliverableBlock(ranked, candidates, hour);
      const { perAngle, totalEligible, projectStatus } = allocateAcrossAngles(
        blocked,
        angleInputs as { key: string; staffCount: number }[]
      );
      return { ranked: blocked, perAngle, totalEligible, projectStatus };
    }
  );

  app.post<{
    Body: {
      client?: string;
      account?: string;
      topic?: string;
      projectLink?: string;
      projectType?: string;
      expertPool?: string;
      clientEntity?: number;
      angles?: {
        name?: string;
        callsN?: number;
        goalTotal?: number;
        assignments?: { delivererId: string; goal: number; override?: { justification: string } }[];
        /** "Invisible competition" — per-angle opt-out for ghost suggestion below; omitted means the column's own default (true). */
        invisibleCompetitionEnabled?: boolean;
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
    // Optional at creation (defaults to 1, matching the column default) --
    // a cosmetic grouping label, not worth making every existing caller of
    // this route pass one. Validated when it IS given.
    if (body.clientEntity !== undefined && !CLIENT_ENTITIES.includes(body.clientEntity)) {
      throw badRequest("clientEntity must be one of 1, 2, 3, 4, 5");
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
    // Built out here (not inside the closure below) so TypeScript keeps the
    // narrowing from this handler's earlier body validation — narrowing is
    // reset inside a nested function scope.
    const projectInput = {
      plId: actor.id,
      client: body.client,
      account: body.account,
      topic: body.topic,
      projectLink: body.projectLink,
      projectType: body.projectType,
      expertPool: body.expertPool,
      status: allAssignments.length > 0 ? ("active" as const) : ("open" as const),
      clientEntity: body.clientEntity ?? 1,
    };

    // Create the project + its angles + assignments + audit rows atomically:
    // a failure partway (e.g. a duplicate/invalid deliverer) must not leave an
    // orphaned or half-staffed project committed. Notifications/WS publish only
    // after the transaction commits (below), never on rollback.
    //
    // "Invisible competition" — the ghost-allocation pass runs INSIDE the same
    // transaction (a ghost assignment is part of the same atomic create), but
    // its notifications are collected and sent only after commit.
    const ghostDelivererIds: string[] = [];
    const ghostNotifications: { personId: string; goal: number }[] = [];
    const isDDOrStrategy = body.projectType === "Due Diligence" || body.projectType === "Strategy";

    const project = await withTransaction(async (tx) => {
      const created = await createProject(
        projectInput,
        tx
      );

      // Angles that got a real associate AND are eligible for a ghost
      // suggestion (Due Diligence/Strategy only, never Pitch; toggle not
      // explicitly off). Populated in the loop, consumed by the ghost pass.
      const ghostEligibleAngles: { id: string; realGoal: number }[] = [];

      for (const ang of angleInputs) {
        const createdAngle = await createAngle(
          created.id,
          ang.name!.trim(),
          ang.callsN!,
          ang.goalTotal!,
          ang.invisibleCompetitionEnabled,
          tx
        );
        for (const a of ang.assignments ?? []) {
          await createAssignment(createdAngle.id, a.delivererId, a.goal, false, tx);
          // §6 (built) — an override (the PL picked someone other than who the
          // ranking/auto-match suggested) always carries a justification; log it
          // to the audit trail. Never notify anyone about the override itself —
          // the ordinary "assigned" notification below still reaches the person.
          if (a.override?.justification) {
            await insertAuditLog(
              {
                entityType: "assignment",
                entityId: created.id,
                actorId: actor.id,
                action: "manual_override",
                newValue: { pickedInstead: a.delivererId, justification: a.override.justification },
              },
              tx
            );
          }
        }
        // §6 (built) — audit-log whenever the PL revises an angle's suggested goal downwards, before it's ever staffed.
        const suggested = suggestGoal(ang.callsN!, body.projectType as ProjectType);
        if (ang.goalTotal! < suggested) {
          await insertAuditLog(
            {
              entityType: "angle",
              entityId: createdAngle.id,
              actorId: actor.id,
              action: "downward_goal_revision",
              oldValue: { suggestedGoal: suggested },
              newValue: { goalTotal: ang.goalTotal },
            },
            tx
          );
        }
        // "Invisible competition" — a ghost only ever mirrors an ALREADY-staffed
        // real associate on this same angle ("complementary, never a
        // replacement"); an angle with zero real assignments has no one for it
        // to compete against, so it's never a candidate here.
        const firstRealAssignment = (ang.assignments ?? [])[0];
        if (isDDOrStrategy && firstRealAssignment && createdAngle.invisibleCompetitionEnabled) {
          ghostEligibleAngles.push({ id: createdAngle.id, realGoal: firstRealAssignment.goal });
        }
      }

      // ONE ranking pass across every eligible angle, reusing
      // rankCandidates()/applyFirstDeliverableBlock()/allocateAcrossAngles()
      // verbatim (not forked): only the candidate POOL differs (ghost-flagged
      // people). SILENT FAILURE per angle — no eligible ghost means that angle
      // simply gets none: no warning, no notification, no broadcast.
      if (ghostEligibleAngles.length > 0) {
        const now = resolveNow(request);
        const hour = dubaiHour(now);
        const rotaSet = await sundayRotaPersonIdsForDate(dubaiDateKey(now));
        const ghostContext = { now, sundayRotaPersonIds: rotaSet, plPracticeArea: actor.practiceArea ?? "" };
        const ghostCandidates = await listAvailableCandidatesWithAssignments({ ghost: true });
        const ghostRanked = applyFirstDeliverableBlock(rankCandidates(ghostCandidates, ghostContext), ghostCandidates, hour);
        const { perAngle } = allocateAcrossAngles(
          ghostRanked,
          ghostEligibleAngles.map((a) => ({ key: a.id, staffCount: 1 }))
        );
        for (const alloc of perAngle) {
          const pick = alloc.picked[0];
          if (!pick) continue; // silent failure — no ghost available for this angle
          const angleInfo = ghostEligibleAngles.find((a) => a.id === alloc.key)!;
          const ghostAssignment = await createAssignment(angleInfo.id, pick.personId, angleInfo.realGoal, true, tx);
          ghostDelivererIds.push(pick.personId);
          ghostNotifications.push({ personId: pick.personId, goal: angleInfo.realGoal });
          await insertAuditLog(
            {
              entityType: "assignment",
              entityId: ghostAssignment.id,
              actorId: actor.id,
              action: "ghost_assign",
              newValue: { personId: pick.personId, angleId: angleInfo.id, goal: angleInfo.realGoal },
            },
            tx
          );
        }
      }

      await insertAuditLog(
        { entityType: "project", entityId: created.id, actorId: actor.id, action: "create", newValue: body },
        tx
      );
      return created;
    });

    // Ghost "assigned" notifications — deliberately identical wording to a
    // real assignment's (the ghost never knows they're the competition).
    for (const g of ghostNotifications) {
      await notify({
        personId: g.personId,
        type: "assigned",
        title: "New project assigned to you",
        body: `${project.client} — you've been staffed with a goal of ${g.goal}.`,
        entityType: "project",
        entityId: project.id,
      });
    }

    await publishProjectChanged(project.id, [actor.id, ...allAssignments.map((a) => a.delivererId), ...ghostDelivererIds]);
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
      await notifyBroadcastRecipients(project, resolveNow(request));
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
      if (request.body && "clientEntity" in request.body) {
        const entity = request.body.clientEntity;
        if (typeof entity !== "number" || !CLIENT_ENTITIES.includes(entity)) {
          throw badRequest("clientEntity must be one of 1, 2, 3, 4, 5");
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
    const updated = await archiveProject(project.id);
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
    const updated = await resurfaceProject(project.id);
    await insertAuditLog({ entityType: "project", entityId: project.id, actorId: actor.id, action: "resurface" });
    const assignments = await listAssignmentsByProject(project.id);
    await publishProjectChanged(project.id, [project.plId, ...assignments.map((a) => a.delivererId)]);
    publish({ type: "capacity-ranking" });
    return updated;
  });

  /**
   * Batch S — soft delete. PL-only (same rule as archive — canArchiveProject
   * reused, not duplicated, since it's exactly "actor is the PL" either
   * way). The confirmation step lives client-side (this is the destructive
   * action itself, not a place to add a second one server-side); this route
   * commits once called. Never a hard delete — see softDeleteProject().
   */
  app.post<{ Params: { id: string } }>("/:id/delete", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const project = await findProjectById(request.params.id);
    if (!project) throw notFound("project not found");
    if (!canArchiveProject(actor.id, project)) throw forbidden("only the PL may delete this project");
    const deleted = await softDeleteProject(project.id);
    if (!deleted) throw notFound("project not found");
    await insertAuditLog({ entityType: "project", entityId: project.id, actorId: actor.id, action: "delete" });
    const assignments = await listAssignmentsByProject(project.id);
    await publishProjectChanged(project.id, [project.plId, ...assignments.map((a) => a.delivererId)]);
    publish({ type: "capacity-ranking" });
    return { id: project.id };
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

      // Claim ONE seat on the project's first angle, atomically — identical
      // semantics to /angles/:id/claim. Previously this flipped the WHOLE
      // project to 'active' on the first acceptor and assigned them the entire
      // angle goal, which silently abandoned any still-open seats (dropping the
      // project off the broadcast) and over-assigned the goal. Now the project
      // only goes 'active' once every angle has hit its seat target.
      const angles = await listAnglesByProject(project.id);
      const angle = angles[0];
      const target = seatTargetForAngle(angle.callsN, project.projectType as ProjectType);
      const goal = request.body?.goal ?? Math.max(1, Math.ceil(angle.goalTotal / target));
      const claimed = await claimAngleSeat(angle.id, actor.id, goal);
      if (!claimed) throw conflict("that seat is no longer available");

      const fullyStaffed = await activateProjectIfFullyStaffed(project.id, project.projectType as ProjectType);

      await insertAuditLog({
        entityType: "assignment",
        entityId: claimed.id,
        actorId: actor.id,
        action: "claim_broadcast_seat",
        newValue: { angleId: angle.id, delivererId: actor.id, goal },
      });
      await publishProjectChanged(project.id, [project.plId, actor.id]);
      // §4 first-commit-wins — everyone else's open pool must drop this immediately.
      publish({ type: "open-pool" });
      publish({ type: "capacity-ranking" });
      // Mirror /claim: tell the PL a broadcast seat was taken.
      await notify({
        personId: project.plId,
        type: "assigned",
        title: "Seat claimed from the broadcast",
        body: `${project.client} — ${angle.name} just got a new deliverer from the broadcast.`,
        entityType: "project",
        entityId: project.id,
      });
      return { angleId: angle.id, assignmentId: claimed.id, fullyStaffed };
    }
  );

  /**
   * CHANGE 3 — broadcast fallback listing. Org-wide, no team scoping (same
   * visibility as the existing open pool — never restricted to the PL's own
   * team, since eligibility never was). Only projects that are still
   * `status = 'open'` qualify: that's precisely "auto-assign filled zero
   * seats anywhere" (a partially-filled project already has assignments
   * somewhere, so its status is 'active', not 'open' — Change 4's
   * partial-fill case can never show up here, by construction). Each
   * qualifying angle's target headcount is `seatTargetForAngle()`, the same
   * formula intake itself suggests, recomputed live — see that function's
   * doc comment for why (no schema change to store a PL-adjusted override).
   */
  app.get("/broadcasts", { preHandler: [app.requireAuth] }, async () => {
    const openProjects = await listProjects({ status: "open" });
    const out: {
      projectId: string;
      client: string;
      topic: string | null;
      projectLink: string;
      projectType: ProjectType;
      expertPool: string;
      angleId: string;
      angleName: string;
      callsN: number;
      goalTotal: number;
      remaining: number;
    }[] = [];
    for (const project of openProjects) {
      const angles = await listAnglesByProject(project.id);
      for (const angle of angles) {
        const target = seatTargetForAngle(angle.callsN, project.projectType as ProjectType);
        const filled = await countAssignmentsForAngle(angle.id);
        const remaining = target - filled;
        if (remaining > 0) {
          out.push({
            projectId: project.id,
            client: project.client,
            topic: project.topic,
            projectLink: project.projectLink,
            projectType: project.projectType as ProjectType,
            expertPool: project.expertPool,
            angleId: angle.id,
            angleName: angle.name,
            callsN: angle.callsN,
            goalTotal: angle.goalTotal,
            remaining,
          });
        }
      }
    }
    return out;
  });

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
