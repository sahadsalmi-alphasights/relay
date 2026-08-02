import { insertAuditLog } from "../repositories/auditLog";
import { findAssignmentById, setAssignmentStage, updateAssignmentGoal } from "../repositories/assignments";
import {
  findGoalChangeRequestById,
  resolveGoalChangeRequest,
  type GoalChangeRequestRow,
} from "../repositories/goalChangeRequests";
import { findProjectById, setProjectStatus } from "../repositories/projects";
import { goalChangeTargetLabel, isStageTarget } from "../rules/goalChange";
import type { Stage } from "../rules/types";
import { notify } from "./notify";
import { publish } from "../ws/hub";
import { projectRecipientIds } from "../ws/recipients";

export interface ResolveInput {
  outcome: "accepted" | "declined";
  /** Optional PL edits applied at accept time ("accept with changes"). */
  goalOverride?: number | null;
  statusOverride?: string | null;
}

export interface ResolveResult {
  request: GoalChangeRequestRow;
  /** True when the applied goal/status differ from what was requested. */
  changed: boolean;
  /** For the caller (e.g. Slack) to echo a confirmation. */
  client: string;
}

/**
 * Apply + resolve a goal-change request in one place, shared by the HTTP
 * resolve route and the inbound Slack Accept handler. Accepting applies the
 * requested goal and *delivery stage* (or archives the project when the target
 * is "Archive"); a PL may override either at accept time, which flags the
 * result as "accepted with changes". Declining touches nothing. Idempotent on
 * an already-resolved request. The CALLER performs the permission check.
 *
 * Returns null when the request/assignment/project can't be found.
 */
export async function applyAndResolveGoalChange(
  gcrId: string,
  actorId: string,
  input: ResolveInput,
  via: "app" | "slack" = "app"
): Promise<ResolveResult | null> {
  const gcr = await findGoalChangeRequestById(gcrId);
  if (!gcr) return null;
  const assignment = await findAssignmentById(gcr.assignmentId);
  if (!assignment) return null;
  const project = await findProjectById(assignment.projectId);
  if (!project) return null;

  // Idempotent: a double-click / concurrent resolve (or an app-accept then a
  // stale Slack-accept) must not re-apply or re-notify.
  if (gcr.resolved) return { request: gcr, changed: false, client: project.client };

  const appliedGoal = input.outcome === "accepted" ? input.goalOverride ?? gcr.requestedGoal : gcr.requestedGoal;
  const appliedStatus =
    input.outcome === "accepted" ? input.statusOverride ?? gcr.requestedStatus : gcr.requestedStatus;

  if (input.outcome === "accepted") {
    if (appliedGoal !== null && appliedGoal !== undefined) {
      await updateAssignmentGoal(assignment.id, { goal: appliedGoal });
    }
    if (appliedStatus) {
      if (appliedStatus === "Archive") await setProjectStatus(project.id, "archived");
      else if (isStageTarget(appliedStatus)) await setAssignmentStage(assignment.id, appliedStatus as Stage);
    }
  }
  const changed =
    input.outcome === "accepted" &&
    (appliedGoal !== gcr.requestedGoal || appliedStatus !== gcr.requestedStatus);

  const resolved = await resolveGoalChangeRequest(gcr.id, input.outcome);
  await insertAuditLog({
    entityType: "goal_change_request",
    entityId: gcr.id,
    actorId,
    action: "resolve",
    newValue: { outcome: input.outcome, appliedGoal, appliedStatus, changed, via },
  });

  const recipients = await projectRecipientIds([project.plId, assignment.delivererId]);
  publish({ type: "project", projectId: project.id }, recipients);
  publish({ type: "capacity-ranking" });

  // Notify the deliverer who raised it — accepted / accepted-with-changes /
  // declined are three distinct messages.
  if (input.outcome === "accepted") {
    const statusLabel = appliedStatus ? goalChangeTargetLabel(appliedStatus) : "unchanged";
    await notify({
      personId: assignment.delivererId,
      type: "goal_change_resolved",
      title: changed ? "Your goal change request was accepted (with changes)" : "Your goal change request was accepted",
      body: `${project.client}: your goal change request was accepted${changed ? " with changes" : ""} — goal ${appliedGoal}, status ${statusLabel}.`,
      entityType: "goal_change_request",
      entityId: gcr.id,
    });
  } else {
    await notify({
      personId: assignment.delivererId,
      type: "goal_change_resolved",
      title: "Your goal change request was declined",
      body: `${project.client}: your request has been declined by the PL.`,
      entityType: "goal_change_request",
      entityId: gcr.id,
    });
  }

  return { request: resolved, changed, client: project.client };
}
