import type { FastifyPluginAsync } from "fastify";
import { insertAuditLog } from "../repositories/auditLog";
import { findAssignmentById } from "../repositories/assignments";
import { findGoalChangeRequestById, resolveGoalChangeRequest } from "../repositories/goalChangeRequests";
import { findProjectById } from "../repositories/projects";
import { forbidden, notFound } from "../errors";
import { canResolveGoalChangeRequest } from "../rules/permissions";
import { notify } from "../services/notify";
import { publish } from "../ws/hub";
import { projectRecipientIds } from "../ws/recipients";

/** §5e — only the PL may resolve a goal change request. */
const goalChangeRequestsRoutes: FastifyPluginAsync = async (app) => {
  app.patch<{ Params: { id: string } }>("/:id/resolve", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const gcr = await findGoalChangeRequestById(request.params.id);
    if (!gcr) throw notFound("goal change request not found");
    const assignment = await findAssignmentById(gcr.assignmentId);
    if (!assignment) throw notFound("assignment not found");
    const project = await findProjectById(assignment.projectId);
    if (!project) throw notFound("project not found");
    if (!canResolveGoalChangeRequest(actor.id, project)) {
      throw forbidden("only the PL may resolve a goal change request");
    }
    const resolved = await resolveGoalChangeRequest(gcr.id);
    await insertAuditLog({
      entityType: "goal_change_request",
      entityId: gcr.id,
      actorId: actor.id,
      action: "resolve",
    });
    const recipients = await projectRecipientIds([project.plId, assignment.delivererId]);
    publish({ type: "project", projectId: project.id }, recipients);
    // §9 (built) — resolved -> notify the deliverer who raised it.
    await notify({
      personId: assignment.delivererId,
      type: "goal_change_resolved",
      title: "Your goal change request was resolved",
      body: `${project.client}: your request has been resolved by the PL.`,
      entityType: "goal_change_request",
      entityId: gcr.id,
    });
    return resolved;
  });
};

export default goalChangeRequestsRoutes;
