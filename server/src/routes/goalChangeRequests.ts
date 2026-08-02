import type { FastifyPluginAsync } from "fastify";
import { findAssignmentById } from "../repositories/assignments";
import { findGoalChangeRequestById } from "../repositories/goalChangeRequests";
import { findProjectById } from "../repositories/projects";
import { badRequest, forbidden, notFound } from "../errors";
import { canResolveGoalChangeRequest } from "../rules/permissions";
import { isGoalChangeTarget } from "../rules/goalChange";
import { applyAndResolveGoalChange } from "../services/goalChangeResolve";

/**
 * §5e — only the PL or a manager may resolve a goal change request.
 *
 * Notifications batch — accepting applies the requested goal AND delivery
 * stage (or archives the project when the target is "Archive"). A PL may also
 * override the goal/stage in the accept body ("accept with changes"), which
 * the deliverer's confirmation notification reflects. The effect lives in the
 * shared applyAndResolveGoalChange() service (reused by the Slack Accept
 * button); this route is just permission + validation over it.
 */
const goalChangeRequestsRoutes: FastifyPluginAsync = async (app) => {
  app.patch<{
    Params: { id: string };
    Body: { outcome?: "accepted" | "declined"; goal?: number; status?: string };
  }>("/:id/resolve", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const gcr = await findGoalChangeRequestById(request.params.id);
    if (!gcr) throw notFound("goal change request not found");
    const assignment = await findAssignmentById(gcr.assignmentId);
    if (!assignment) throw notFound("assignment not found");
    const project = await findProjectById(assignment.projectId);
    if (!project) throw notFound("project not found");
    if (!canResolveGoalChangeRequest(actor, project)) {
      throw forbidden("only the PL or a manager may resolve a goal change request");
    }
    const outcome = request.body?.outcome;
    if (outcome !== "accepted" && outcome !== "declined") {
      throw badRequest("outcome must be 'accepted' or 'declined'");
    }
    const goalOverride = request.body?.goal;
    if (goalOverride !== undefined && (typeof goalOverride !== "number" || !Number.isFinite(goalOverride) || goalOverride < 0)) {
      throw badRequest("goal must be a non-negative number");
    }
    const statusOverride = request.body?.status;
    if (statusOverride !== undefined && !isGoalChangeTarget(statusOverride)) {
      throw badRequest("status must be a valid stage target");
    }

    const result = await applyAndResolveGoalChange(gcr.id, actor.id, {
      outcome,
      goalOverride: goalOverride ?? null,
      statusOverride: statusOverride ?? null,
    });
    if (!result) throw notFound("goal change request not found");
    return result.request;
  });
};

export default goalChangeRequestsRoutes;
