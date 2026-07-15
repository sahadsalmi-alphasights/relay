import { listFirstDeliverableAssignments, markStaleNotified } from "../repositories/assignments";
import { findProjectById } from "../repositories/projects";
import { notify } from "./notify";

const THRESHOLD_STEP_MINUTES = 30;

/**
 * §9 (built) — "an assignment sits in First Deliverable for 30+ minutes with
 * no progress logged" is a scheduler, not a WebSocket event: nobody acted,
 * time simply passed, so nothing in the app triggers a check except the
 * clock itself.
 *
 * Dedup: `stale_notified_threshold_minutes` records the highest 30-minute
 * multiple already notified for. A tick only notifies again once elapsed
 * time crosses the NEXT multiple (30, then 60, then 90, ...), so a given
 * idle stretch produces exactly one notification per threshold, never a
 * repeat of one already sent. Logging progress or changing stage resets
 * both the baseline and this counter (see repositories/assignments.ts).
 */
export async function checkStaleAssignments(now: Date): Promise<void> {
  const candidates = await listFirstDeliverableAssignments();

  for (const a of candidates) {
    const baselineMs = Math.max(new Date(a.stageEnteredAt).getTime(), new Date(a.progressUpdatedAt).getTime());
    const elapsedMinutes = (now.getTime() - baselineMs) / 60_000;
    if (elapsedMinutes < THRESHOLD_STEP_MINUTES) continue;

    const crossedThreshold = Math.floor(elapsedMinutes / THRESHOLD_STEP_MINUTES) * THRESHOLD_STEP_MINUTES;
    if (crossedThreshold <= a.staleNotifiedThresholdMinutes) continue;

    const project = await findProjectById(a.projectId);
    if (!project) continue;

    await markStaleNotified(a.id, crossedThreshold);

    await notify({
      personId: a.delivererId,
      type: "stale_first_deliverable",
      title: "Still on First Deliverable",
      body: `${project.client} has been in First Deliverable for ${crossedThreshold}+ minutes with no progress logged.`,
      entityType: "assignment",
      entityId: a.id,
    });
    await notify({
      personId: a.projectPlId,
      type: "stale_first_deliverable",
      title: "Deliverer stalled on First Deliverable",
      body: `${project.client}'s assignee has been in First Deliverable for ${crossedThreshold}+ minutes with no progress logged.`,
      entityType: "assignment",
      entityId: a.id,
    });
  }
}

/** `.unref()`'d so it never keeps the process (or a test) alive on its own. */
export function startStaleScheduler(intervalMs = 60_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    checkStaleAssignments(new Date()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("stale scheduler tick failed", err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
