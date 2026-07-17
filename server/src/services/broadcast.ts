import { countAssignmentsForAngle, listAnglesByProject, seatTargetForAngle } from "../repositories/angles";
import { lastNotificationAt } from "../repositories/notifications";
import { listBroadcastRecipients } from "../repositories/people";
import { listProjects, type ProjectRow } from "../repositories/projects";
import { isAfterHours } from "../rules/time";
import type { ProjectType } from "../rules/types";
import { notify } from "./notify";

const REPING_INTERVAL_MINUTES = 15;

/**
 * CHANGE 3 — broadcast fallback. Fires ONLY when auto-assign filled zero
 * seats anywhere on the project (status === 'open' at creation time — see
 * rules/matching.ts allocateAcrossAngles()'s totalEligible === 0 case).
 * Recipients are a deliberately WIDER net than matching's Available-only
 * candidates — everyone except Sick/On vacation always, and except Offline
 * too unless it's currently the evening-coverage window (§4 Rule 3) —
 * computed live at send time, not trusted from whatever /intake/match saw
 * earlier. Shared between the route (first ping, at project creation) and
 * the re-ping scheduler below (every subsequent 15-minute round).
 */
export async function notifyBroadcastRecipients(project: ProjectRow, now: Date): Promise<void> {
  const recipients = await listBroadcastRecipients(isAfterHours(now));
  for (const person of recipients) {
    await notify({
      personId: person.id,
      type: "open_pool",
      title: "Project up for grabs",
      body: `${project.client} has no one staffed — everyone's busy on fresh projects. First to accept takes a seat.`,
      entityType: "project",
      entityId: project.id,
    });
  }
}

/**
 * CHANGE 3 — "if still unfilled after 15 minutes, re-ping." There's no
 * broadcast table to track "when did we last ping this" (no-schema-changes
 * constraint for this batch) — so this derives it from the newest
 * notification row already written for that project (entityType='project',
 * type='open_pool'), which notifyBroadcastRecipients() itself creates one of
 * per recipient every round. A project drops out of consideration the
 * moment it's no longer `status = 'open'` (fully staffed, or the PL
 * archived/withdrew it) — same qualifying set GET /projects/broadcasts uses.
 */
export async function checkBroadcastRepings(now: Date): Promise<void> {
  const openProjects = await listProjects({ status: "open" });

  for (const project of openProjects) {
    const angles = await listAnglesByProject(project.id);
    let stillNeedsSeats = false;
    for (const angle of angles) {
      const target = seatTargetForAngle(angle.callsN, project.projectType as ProjectType);
      const filled = await countAssignmentsForAngle(angle.id);
      if (filled < target) {
        stillNeedsSeats = true;
        break;
      }
    }
    if (!stillNeedsSeats) continue;

    const lastPingAt = await lastNotificationAt("project", project.id, "open_pool");
    const elapsedMinutes = lastPingAt ? (now.getTime() - new Date(lastPingAt).getTime()) / 60_000 : Infinity;
    if (elapsedMinutes < REPING_INTERVAL_MINUTES) continue;

    await notifyBroadcastRecipients(project, now);
  }
}

/** `.unref()`'d so it never keeps the process (or a test) alive on its own — same pattern as services/staleScheduler.ts. */
export function startBroadcastRepingScheduler(intervalMs = 60_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    checkBroadcastRepings(new Date()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("broadcast re-ping scheduler tick failed", err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
