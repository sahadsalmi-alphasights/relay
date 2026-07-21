import type { FastifyPluginAsync } from "fastify";
import { insertAuditLog } from "../repositories/auditLog";
import { findAssignmentById, updateAssignmentGoal } from "../repositories/assignments";
import { findGoalChangeRequestById, resolveGoalChangeRequest } from "../repositories/goalChangeRequests";
import { findProjectById, setProjectStatus } from "../repositories/projects";
import { badRequest, forbidden, notFound } from "../errors";
import { canResolveGoalChangeRequest } from "../rules/permissions";
import { notify } from "../services/notify";
import { publish } from "../ws/hub";
import { projectRecipientIds } from "../ws/recipients";

/**
 * §5e — only the PL or a manager may resolve a goal change request.
 *
 * Batch S, item 4 — resolve is no longer a single undifferentiated action:
 * the PL must say ACCEPT or DECLINE. Accepting actually applies what was
 * requested (goal via the existing updateAssignmentGoal() — reused, not
 * duplicated — and status via the new setProjectStatus()); declining
 * resolves the request without touching either. Before Batch S, "resolve"
 * never changed the goal at all — the PL had to separately use the goal
 * stepper. This is what actually connects the request to an effect.
 */
const goalChangeRequestsRoutes: FastifyPluginAsync = async (app) => {
  app.patch<{ Params: { id: string }; Body: { outcome?: "accepted" | "declined" } }>(
    "/:id/resolve",
    { preHandler: [app.requireAuth] },
    async (request) => {
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
      // Idempotent: a double-click / concurrent resolve must not re-apply the
      // requested goal/status or re-fire the notification — even more
      // important now that accepting has side effects.
      if (gcr.resolved) return gcr;

      if (outcome === "accepted") {
        if (gcr.requestedGoal !== null) await updateAssignmentGoal(assignment.id, { goal: gcr.requestedGoal });
        if (gcr.requestedStatus !== null) await setProjectStatus(project.id, gcr.requestedStatus);
      }
      const resolved = await resolveGoalChangeRequest(gcr.id, outcome);
      await insertAuditLog({
        entityType: "goal_change_request",
        entityId: gcr.id,
        actorId: actor.id,
        action: "resolve",
        newValue: { outcome, appliedGoal: gcr.requestedGoal, appliedStatus: gcr.requestedStatus },
      });
      const recipients = await projectRecipientIds([project.plId, assignment.delivererId]);
      publish({ type: "project", projectId: project.id }, recipients);
      publish({ type: "capacity-ranking" });
      // §9 (built) — resolved -> notify the deliverer who raised it.
      await notify({
        personId: assignment.delivererId,
        type: "goal_change_resolved",
        title: outcome === "accepted" ? "Your goal change request was accepted" : "Your goal change request was declined",
        body: `${project.client}: your request has been ${outcome} by the PL.`,
        entityType: "goal_change_request",
        entityId: gcr.id,
      });
      return resolved;
    }
  );
};

export default goalChangeRequestsRoutes;
