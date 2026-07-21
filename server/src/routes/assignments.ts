import type { FastifyPluginAsync } from "fastify";
import { insertAuditLog } from "../repositories/auditLog";
import {
  findAssignmentById,
  listAssignmentsByProject,
  setAssignmentStage,
  updateAssignmentDeliverer,
  updateAssignmentGoal,
  updateAssignmentProgress,
} from "../repositories/assignments";
import { createGoalChangeRequest } from "../repositories/goalChangeRequests";
import { cumulativeDeliveredForAssignment, listRoundsForAssignment } from "../repositories/deliveryRounds";
import { findProjectById } from "../repositories/projects";
import { badRequest, forbidden, notFound } from "../errors";
import {
  canChangeStage,
  canEditAssignmentProgress,
  canEditGoal,
  canRequestGoalChange,
  canSwapDeliverer,
} from "../rules/permissions";
import { STAGE_ORDER } from "../rules/config";
import { advanceStage, backStage } from "../rules/stage";
import { swapDeliverer } from "../rules/swap";
import type { ProjectStatus, Stage } from "../rules/types";
import { notify } from "../services/notify";
import { publish } from "../ws/hub";
import { projectRecipientIds } from "../ws/recipients";

const PROJECT_STATUSES: ProjectStatus[] = ["open", "active", "archived"];

async function publishProjectChanged(projectId: string, involvedPersonIds: string[]): Promise<void> {
  const recipients = await projectRecipientIds(involvedPersonIds);
  publish({ type: "project", projectId }, recipients);
}

const assignmentsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>("/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const assignment = await findAssignmentById(request.params.id);
    if (!assignment) throw notFound("assignment not found");
    return assignment;
  });

  // §3/§5 (domain change 9) — round history, plus cumulative delivered across
  // every round for analytics. Read-only, same open-read pattern as GET /:id.
  app.get<{ Params: { id: string } }>("/:id/rounds", { preHandler: [app.requireAuth] }, async (request) => {
    const assignment = await findAssignmentById(request.params.id);
    if (!assignment) throw notFound("assignment not found");
    const history = await listRoundsForAssignment(assignment.id);
    const cumulativeDelivered = await cumulativeDeliveredForAssignment(assignment.id, assignment.delivered);
    return { history, cumulativeDelivered };
  });

  // §5e — a deliverer may edit only their own delivered/custom_delivered.
  app.patch<{ Params: { id: string }; Body: { delivered?: number; customDelivered?: number } }>(
    "/:id/progress",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const assignment = await findAssignmentById(request.params.id);
      if (!assignment) throw notFound("assignment not found");
      if (!canEditAssignmentProgress(actor.id, assignment)) {
        throw forbidden("only the assignment's own deliverer may edit progress");
      }
      // Reject non-integers / negatives / absurd values: a raw pass-through
      // would 500 on out-of-range ints, and a negative delivered would inflate
      // the deliverer's remaining-load in the capacity ranking.
      const { delivered, customDelivered } = request.body ?? {};
      for (const [field, val] of Object.entries({ delivered, customDelivered })) {
        if (val !== undefined && (!Number.isInteger(val) || val < 0 || val > 1_000_000)) {
          throw badRequest(`${field} must be a non-negative integer`);
        }
      }
      const updated = await updateAssignmentProgress(assignment.id, request.body ?? {});
      await insertAuditLog({
        entityType: "assignment",
        entityId: assignment.id,
        actorId: actor.id,
        action: "update_progress",
        oldValue: assignment,
        newValue: request.body,
      });
      const project = await findProjectById(assignment.projectId);
      if (project) {
        await publishProjectChanged(project.id, [project.plId, assignment.delivererId]);
        // §5 (eight changes) — a delivery logged -> notify the PL to review.
        await notify({
          personId: project.plId,
          type: "delivery_logged",
          title: "Delivery logged — review",
          body: `${actor.name} logged progress on ${project.client}: ${updated.delivered + updated.customDelivered}/${updated.goal}.`,
          entityType: "assignment",
          entityId: assignment.id,
        });
      }
      // Logging profiles changes remaining -> load; capacity ranking is org-wide (bugs 1+2's own fix depends on this staying live).
      publish({ type: "capacity-ranking" });
      return updated;
    }
  );

  /**
   * §5e — THE PL OWNS THE GOAL, ALWAYS. A deliverer may never write goal or
   * custom_goal. This check runs here, at the route, independent of the
   * canEditGoal() unit tests in rules/permissions.test.ts — this is what
   * proves the rule is actually wired into the HTTP layer, not just correct
   * in isolation.
   *
   * §5 (domain change 7) — custom_goal is not accepted in the body at all;
   * it's always recomputed from goal, never set by hand.
   */
  app.patch<{ Params: { id: string }; Body: { goal?: number } }>(
    "/:id/goal",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const assignment = await findAssignmentById(request.params.id);
      if (!assignment) throw notFound("assignment not found");
      const project = await findProjectById(assignment.projectId);
      if (!project) throw notFound("project not found");
      if (!canEditGoal(actor, project)) {
        throw forbidden("only the project's PL may edit goal/custom_goal");
      }
      if (typeof request.body?.goal !== "number") {
        throw badRequest("goal is required");
      }
      if (!Number.isInteger(request.body.goal) || request.body.goal < 0 || request.body.goal > 1_000_000) {
        throw badRequest("goal must be a non-negative integer");
      }
      const updated = await updateAssignmentGoal(assignment.id, { goal: request.body.goal });
      await insertAuditLog({
        entityType: "assignment",
        entityId: assignment.id,
        actorId: actor.id,
        action: "update_goal",
        oldValue: assignment,
        newValue: request.body,
      });
      await publishProjectChanged(project.id, [project.plId, assignment.delivererId]);
      publish({ type: "capacity-ranking" });
      return updated;
    }
  );

  // §6/§8 — stage is per-assignment now (domain change 8): each deliverer on
  // a project can be at a different stage. PL-only, same as before.
  app.post<{ Params: { id: string } }>("/:id/stage/advance", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const assignment = await findAssignmentById(request.params.id);
    if (!assignment) throw notFound("assignment not found");
    const project = await findProjectById(assignment.projectId);
    if (!project) throw notFound("project not found");
    if (!canChangeStage(actor, project)) throw forbidden("only the PL or a manager may change stage");
    const nextStage = advanceStage(assignment.stage);
    const updated = await setAssignmentStage(assignment.id, nextStage);
    await insertAuditLog({
      entityType: "assignment",
      entityId: assignment.id,
      actorId: actor.id,
      action: "advance_stage",
      oldValue: { stage: assignment.stage },
      newValue: { stage: nextStage },
    });
    await publishProjectChanged(project.id, [project.plId, assignment.delivererId]);
    // Stage weight feeds directly into load (§5c) -- ranking must reflect it live.
    publish({ type: "capacity-ranking" });
    return updated;
  });

  // §6 — "back a stage" for mis-clicks.
  app.post<{ Params: { id: string } }>("/:id/stage/back", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const assignment = await findAssignmentById(request.params.id);
    if (!assignment) throw notFound("assignment not found");
    const project = await findProjectById(assignment.projectId);
    if (!project) throw notFound("project not found");
    if (!canChangeStage(actor, project)) throw forbidden("only the PL or a manager may change stage");
    const prevStage = backStage(assignment.stage);
    const updated = await setAssignmentStage(assignment.id, prevStage);
    await insertAuditLog({
      entityType: "assignment",
      entityId: assignment.id,
      actorId: actor.id,
      action: "back_stage",
      oldValue: { stage: assignment.stage },
      newValue: { stage: prevStage },
    });
    await publishProjectChanged(project.id, [project.plId, assignment.delivererId]);
    publish({ type: "capacity-ranking" });
    return updated;
  });

  /**
   * Phase D, item 1 — a per-deliverer dropdown that can jump straight to any
   * phase, skipping intermediates (unlike /stage/advance's one-step-forward-
   * only). Same permission (PL-only) and same setAssignmentStage() write as
   * advance/back; this is purely a different caller-supplied target instead
   * of a computed next/prev. No schema change — the stage CHECK constraint
   * already allows all four values.
   */
  app.patch<{ Params: { id: string }; Body: { stage?: Stage } }>(
    "/:id/stage",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const assignment = await findAssignmentById(request.params.id);
      if (!assignment) throw notFound("assignment not found");
      const project = await findProjectById(assignment.projectId);
      if (!project) throw notFound("project not found");
      if (!canChangeStage(actor, project)) throw forbidden("only the PL or a manager may change stage");
      const stage = request.body?.stage;
      if (!stage || !STAGE_ORDER.includes(stage)) {
        throw badRequest(`stage must be one of: ${STAGE_ORDER.join(", ")}`);
      }
      const updated = await setAssignmentStage(assignment.id, stage);
      await insertAuditLog({
        entityType: "assignment",
        entityId: assignment.id,
        actorId: actor.id,
        action: "set_stage",
        oldValue: { stage: assignment.stage },
        newValue: { stage },
      });
      await publishProjectChanged(project.id, [project.plId, assignment.delivererId]);
      publish({ type: "capacity-ranking" });
      return updated;
    }
  );

  // §5f/§6 (built) — PL-only; keeps delivered/custom_delivered, credits the
  // original person in the audit trail. An override (picking someone other
  // than who the ranking suggested) carries a justification, logged
  // separately to the audit trail; never a notification about the override
  // itself, only the ordinary "assigned" one below.
  app.post<{ Params: { id: string }; Body: { newDelivererId?: string; override?: { justification?: string } } }>(
    "/:id/swap",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const assignment = await findAssignmentById(request.params.id);
      if (!assignment) throw notFound("assignment not found");
      const project = await findProjectById(assignment.projectId);
      if (!project) throw notFound("project not found");
      if (!canSwapDeliverer(actor, project)) throw forbidden("only the PL or a manager may swap the deliverer");
      if (!request.body?.newDelivererId) throw badRequest("newDelivererId is required");

      // Per-ANGLE duplicate check, matching the add route and the DB's
      // (angle, deliverer) uniqueness: one person may hold seats on two
      // different angles of the same project. This was project-wide, which
      // made cross-angle replacements work at creation but 400 in Edit team.
      const projectAssignments = await listAssignmentsByProject(project.id);
      if (
        projectAssignments.some(
          (a) =>
            a.id !== assignment.id &&
            a.angleId === assignment.angleId &&
            a.delivererId === request.body.newDelivererId
        )
      ) {
        throw badRequest("that person already has an assignment on this angle");
      }

      const { assignment: swapped, auditEntry } = swapDeliverer(assignment, request.body.newDelivererId, actor.id);
      const updated = await updateAssignmentDeliverer(assignment.id, swapped.delivererId);
      await insertAuditLog(auditEntry);
      if (request.body.override) {
        await insertAuditLog({
          entityType: "assignment",
          entityId: assignment.id,
          actorId: actor.id,
          action: "manual_override",
          oldValue: { insteadOf: assignment.delivererId },
          newValue: { pickedInstead: swapped.delivererId, justification: request.body.override.justification || null },
        });
      }
      // Old AND new deliverer must both hear about it -- the old one loses this card entirely.
      await publishProjectChanged(project.id, [project.plId, assignment.delivererId, swapped.delivererId]);
      publish({ type: "capacity-ranking" });
      // §9 (built) — "project assigned to you," same trigger as auto-match, for the newly swapped-in deliverer.
      await notify({
        personId: swapped.delivererId,
        type: "assigned",
        title: "New project assigned to you",
        body: `${project.client} — you've been swapped onto goal ${updated.goal}.`,
        entityType: "project",
        entityId: project.id,
      });
      return updated;
    }
  );

  /**
   * §5e — a deliverer may only *request* a goal change, never write it
   * directly. Batch S, item 4 — the request now carries a structured
   * requestedGoal (numeric) and requestedStatus alongside the existing free-
   * text body (kept as optional rationale/context, no longer the only
   * signal). Both new fields are required: a request the PL can't act on
   * without first going and asking "how much?" defeats the point.
   */
  app.post<{ Params: { id: string }; Body: { body?: string; requestedGoal?: number; requestedStatus?: string } }>(
    "/:id/goal-change-requests",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const assignment = await findAssignmentById(request.params.id);
      if (!assignment) throw notFound("assignment not found");
      if (!canRequestGoalChange(actor.id, assignment)) {
        throw forbidden("only the assignment's own deliverer may request a goal change");
      }
      const { requestedGoal, requestedStatus } = request.body ?? {};
      if (typeof requestedGoal !== "number" || !Number.isFinite(requestedGoal) || requestedGoal < 0) {
        throw badRequest("requestedGoal must be a non-negative number");
      }
      if (!requestedStatus || !PROJECT_STATUSES.includes(requestedStatus as (typeof PROJECT_STATUSES)[number])) {
        throw badRequest(`requestedStatus must be one of: ${PROJECT_STATUSES.join(", ")}`);
      }
      const body = request.body?.body ?? "";
      const created = await createGoalChangeRequest(
        assignment.id,
        actor.id,
        body,
        requestedGoal,
        requestedStatus as (typeof PROJECT_STATUSES)[number]
      );
      const project = await findProjectById(assignment.projectId);
      if (project) {
        await publishProjectChanged(project.id, [project.plId, assignment.delivererId]);
        // §9 (built) — a deliverer raises a request -> notify the PL.
        await notify({
          personId: project.plId,
          type: "goal_change_requested",
          title: "Goal change requested",
          body: `${actor.name} on ${project.client}: goal ${requestedGoal}, status ${requestedStatus}${body ? ` — "${body}"` : ""}.`,
          entityType: "goal_change_request",
          entityId: created.id,
        });
      }
      return created;
    }
  );
};

export default assignmentsRoutes;
