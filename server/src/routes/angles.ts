import type { FastifyPluginAsync } from "fastify";
import {
  activateProjectIfFullyStaffed,
  claimAngleSeat,
  countActiveAnglesForProject,
  countAnglesForProject,
  countAssignmentsForAngle,
  deleteAngleCascade,
  findAngleById,
  listAnglesByProject,
  seatTargetForAngle,
  setAngleArchived,
  updateAngleFields,
} from "../repositories/angles";
import { listAssignmentsByAngle, updateAssignmentGoal } from "../repositories/assignments";
import { insertAuditLog } from "../repositories/auditLog";
import { findProjectById } from "../repositories/projects";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { isEligible } from "../rules/eligibility";
import { canEditProjectFields } from "../rules/permissions";
import { suggestGoal } from "../rules/suggestedGoal";
import type { ProjectType } from "../rules/types";
import { notify } from "../services/notify";
import { resolveNow } from "../lib/requestTime";
import { publish } from "../ws/hub";
import { projectRecipientIds } from "../ws/recipients";

async function publishProjectChanged(projectId: string, involvedPersonIds: string[]): Promise<void> {
  const recipients = await projectRecipientIds(involvedPersonIds);
  publish({ type: "project", projectId }, recipients);
}

const anglesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Rename an angle, edit its N, or (separately) its calls_sold. PL-only.
   *
   * Editing N re-suggests the goal from the project's type; unless the
   * caller also explicitly sets goalTotal, the re-suggestion becomes the new
   * goalTotal. If the goal actually changes AND this angle already has
   * assignments (an active goal), every one of those assignments' own goal
   * is recalculated and pushed through updateAssignmentGoal — the SAME path
   * a stage-driven goal change already uses, so it archives the closed round
   * and starts a new one exactly like that flow does. Editing N never
   * silently rewrites an active goal outside the rounds mechanism.
   */
  app.patch<{
    Params: { id: string };
    Body: { name?: string; callsN?: number; goalTotal?: number; callsSold?: number; expertPool?: string };
  }>("/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const angle = await findAngleById(request.params.id);
    if (!angle) throw notFound("angle not found");
    const project = await findProjectById(angle.projectId);
    if (!project) throw notFound("project not found");
    if (!canEditProjectFields(actor, project)) throw forbidden("only the PL or a manager may edit angles");

    const body = request.body ?? {};
    if (body.name !== undefined && !body.name.trim()) throw badRequest("name cannot be empty");

    const callsNChanging = body.callsN !== undefined && body.callsN !== angle.callsN;
    if (callsNChanging) {
      const minCallsN = project.projectType === "Pitch" ? 0 : 1;
      if (body.callsN! < minCallsN) throw badRequest(`callsN must be >= ${minCallsN} for ${project.projectType}`);
    }

    const patch: Record<string, unknown> = { ...body };
    let suggestedGoalTotal: number | undefined;
    if (callsNChanging) {
      suggestedGoalTotal = suggestGoal(body.callsN!, project.projectType as ProjectType);
      if (patch.goalTotal === undefined) patch.goalTotal = suggestedGoalTotal;
    }

    const updated = await updateAngleFields(angle.id, patch);

    // Per-angle expert pool (2026-07-21) — the pool feeds load weighting, so
    // changing it must refresh the capacity ranking, same as goal changes.
    if (body.expertPool !== undefined && body.expertPool !== angle.expertPool) {
      publish({ type: "capacity-ranking" });
    }

    if (suggestedGoalTotal !== undefined && updated.goalTotal < suggestedGoalTotal) {
      await insertAuditLog({
        entityType: "angle",
        entityId: angle.id,
        actorId: actor.id,
        action: "downward_goal_revision",
        oldValue: { suggestedGoal: suggestedGoalTotal },
        newValue: { goalTotal: updated.goalTotal },
      });
    }

    if (updated.goalTotal !== angle.goalTotal) {
      const angleAssignments = await listAssignmentsByAngle(angle.id);
      if (angleAssignments.length > 0) {
        const perPerson = Math.max(1, Math.ceil(updated.goalTotal / angleAssignments.length));
        for (const a of angleAssignments) {
          await updateAssignmentGoal(a.id, { goal: perPerson });
        }
      }
    }

    await insertAuditLog({
      entityType: "angle",
      entityId: angle.id,
      actorId: actor.id,
      action: "update_fields",
      oldValue: angle,
      newValue: body,
    });

    const finalAssignments = await listAssignmentsByAngle(angle.id);
    await publishProjectChanged(project.id, [project.plId, ...finalAssignments.map((a) => a.delivererId)]);
    publish({ type: "capacity-ranking" });
    return findAngleById(angle.id);
  });

  /**
   * PL/manager. Deletes the angle outright, cascading its assignments (and
   * their rounds/goal-change requests) — a staffed angle can now be removed
   * in one action (2026-07-22), without touching the rest of the project.
   * Still refuses the project's last angle: a project always needs >=1.
   */
  app.delete<{ Params: { id: string } }>("/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const angle = await findAngleById(request.params.id);
    if (!angle) throw notFound("angle not found");
    const project = await findProjectById(angle.projectId);
    if (!project) throw notFound("project not found");
    if (!canEditProjectFields(actor, project)) throw forbidden("only the PL or a manager may remove angles");

    const angleCount = await countAnglesForProject(project.id);
    if (angleCount <= 1) throw badRequest("a project must have at least one angle — delete the project instead");

    await deleteAngleCascade(angle.id);
    await insertAuditLog({ entityType: "angle", entityId: angle.id, actorId: actor.id, action: "delete", oldValue: angle });
    await publishProjectChanged(project.id, [project.plId]);
    publish({ type: "capacity-ranking" });
    return { ok: true };
  });

  /**
   * Per-angle archive / resurface (2026-07-22) — pause one workstream without
   * touching the rest of the project. Archived angles drop out of the card's
   * active roll-up and their deliverers' load (see the load query). Can't
   * archive the project's last active angle — archive the project instead.
   */
  app.post<{ Params: { id: string } }>("/:id/archive", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const angle = await findAngleById(request.params.id);
    if (!angle) throw notFound("angle not found");
    const project = await findProjectById(angle.projectId);
    if (!project) throw notFound("project not found");
    if (!canEditProjectFields(actor, project)) throw forbidden("only the PL or a manager may archive angles");
    if (angle.archivedAt) return angle; // already archived — idempotent
    if ((await countActiveAnglesForProject(project.id)) <= 1) {
      throw badRequest("this is the project's only active angle — archive the project instead");
    }
    const updated = await setAngleArchived(angle.id, true);
    await insertAuditLog({ entityType: "angle", entityId: angle.id, actorId: actor.id, action: "archive" });
    await publishProjectChanged(project.id, [project.plId]);
    publish({ type: "capacity-ranking" });
    return updated;
  });

  app.post<{ Params: { id: string } }>("/:id/resurface", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const angle = await findAngleById(request.params.id);
    if (!angle) throw notFound("angle not found");
    const project = await findProjectById(angle.projectId);
    if (!project) throw notFound("project not found");
    if (!canEditProjectFields(actor, project)) throw forbidden("only the PL or a manager may resurface angles");
    const updated = await setAngleArchived(angle.id, false);
    await insertAuditLog({ entityType: "angle", entityId: angle.id, actorId: actor.id, action: "resurface" });
    await publishProjectChanged(project.id, [project.plId]);
    publish({ type: "capacity-ranking" });
    return updated;
  });

  /**
   * CHANGE 3 — claim one seat on a specific angle from the broadcast
   * fallback. No PL/manager gate: any currently-eligible person may claim,
   * same spirit as the existing project-level `/:id/accept` (§4). Unlike
   * that route, this angle stays claimable by MORE people until its own
   * seat target is met — first-come per seat, not first-come for the whole
   * project. `claimAngleSeat()` is the sole place the seat count is
   * authoritative (row-locked transaction); WebSockets only ever tell
   * clients to refetch, never enforce the count themselves.
   */
  app.post<{ Params: { id: string }; Body: { goal?: number } }>(
    "/:id/claim",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      const angle = await findAngleById(request.params.id);
      if (!angle) throw notFound("angle not found");
      const project = await findProjectById(angle.projectId);
      if (!project) throw notFound("project not found");
      if (project.status !== "open") throw badRequest("this angle is not open for claiming");

      const now = resolveNow(request);
      const elig = isEligible(
        { id: actor.id, status: actor.status, eveningCoverage: actor.eveningCoverage },
        { now }
      );
      if (!elig.eligible) throw forbidden(`not eligible right now: ${elig.reason}`);

      const target = seatTargetForAngle(angle.callsN, project.projectType as ProjectType);
      const goal = request.body?.goal ?? Math.max(1, Math.ceil(angle.goalTotal / target));
      const claimed = await claimAngleSeat(angle.id, actor.id, goal);
      if (!claimed) throw conflict("that seat is no longer available");

      // Once every angle on the project has reached its own target, the
      // project is fully staffed -- flip it active so it drops off the
      // broadcast list entirely. Until then it stays 'open' so its
      // still-short angle(s) (this one or a sibling) keep broadcasting.
      const fullyStaffed = await activateProjectIfFullyStaffed(project.id, project.projectType as ProjectType);

      await insertAuditLog({
        entityType: "assignment",
        entityId: claimed.id,
        actorId: actor.id,
        action: "claim_broadcast_seat",
        newValue: { angleId: angle.id, delivererId: actor.id, goal },
      });
      await publishProjectChanged(project.id, [project.plId, actor.id]);
      // §4 first-commit-wins pattern — everyone else's broadcast list must drop this seat immediately.
      publish({ type: "open-pool" });
      publish({ type: "capacity-ranking" });
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
};

export default anglesRoutes;
