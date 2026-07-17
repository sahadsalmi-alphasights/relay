import type { FastifyPluginAsync } from "fastify";
import {
  countAnglesForProject,
  countAssignmentsForAngle,
  deleteAngle,
  findAngleById,
  updateAngleFields,
} from "../repositories/angles";
import { listAssignmentsByAngle, updateAssignmentGoal } from "../repositories/assignments";
import { insertAuditLog } from "../repositories/auditLog";
import { findProjectById } from "../repositories/projects";
import { badRequest, forbidden, notFound } from "../errors";
import { canEditProjectFields } from "../rules/permissions";
import { suggestGoal } from "../rules/suggestedGoal";
import type { ProjectType } from "../rules/types";
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
    Body: { name?: string; callsN?: number; goalTotal?: number; callsSold?: number };
  }>("/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const angle = await findAngleById(request.params.id);
    if (!angle) throw notFound("angle not found");
    const project = await findProjectById(angle.projectId);
    if (!project) throw notFound("project not found");
    if (!canEditProjectFields(actor.id, project)) throw forbidden("only the PL may edit angles");

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

  /** PL-only. Refuses to delete an angle that still has assignments, or the project's last angle -- a project always needs >=1. */
  app.delete<{ Params: { id: string } }>("/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const angle = await findAngleById(request.params.id);
    if (!angle) throw notFound("angle not found");
    const project = await findProjectById(angle.projectId);
    if (!project) throw notFound("project not found");
    if (!canEditProjectFields(actor.id, project)) throw forbidden("only the PL may remove angles");

    const assignmentCount = await countAssignmentsForAngle(angle.id);
    if (assignmentCount > 0) throw badRequest("remove this angle's assignments before deleting it");

    const angleCount = await countAnglesForProject(project.id);
    if (angleCount <= 1) throw badRequest("a project must have at least one angle");

    await deleteAngle(angle.id);
    await insertAuditLog({ entityType: "angle", entityId: angle.id, actorId: actor.id, action: "delete", oldValue: angle });
    await publishProjectChanged(project.id, [project.plId]);
    return { ok: true };
  });
};

export default anglesRoutes;
