import { listFirstDeliverableAssignments, markStaleNotified } from "../repositories/assignments";
import { findPersonById, managersOfTeam } from "../repositories/people";
import { findProjectById } from "../repositories/projects";
import { nextDubaiMorningMs } from "../rules/time";
import { notify } from "./notify";

// The escalation ladder for a First Deliverable that's overdue with no progress
// logged: 30 min, 1 h, 2 h, 4 h, then one final ping the next morning at 9am
// Dubai. Each step fires exactly once (dedup below).
const LADDER_MINUTES = [30, 60, 120, 240];

/** Human label for a threshold — the final (large) one reads "next morning". */
function thresholdLabel(minutes: number): string {
  if (minutes >= 24 * 60) return "since yesterday";
  if (minutes >= 60) return `${minutes / 60}+ hour${minutes >= 120 ? "s" : ""}`;
  return `${minutes}+ minutes`;
}

/**
 * §9 (built) — "an assignment sits in First Deliverable with no progress
 * logged" is a scheduler, not a WebSocket event: nobody acted, time simply
 * passed, so nothing in the app triggers a check except the clock itself.
 *
 * Notifications batch — the ladder is now a fixed set of steps (30m / 1h / 2h
 * / 4h / next-morning-9am) rather than every 30-minute multiple, and each
 * reminder goes to the deliverer AND the PL AND the manager(s) of the PL's
 * team, so an overdue First Deliverable escalates instead of pinging one bell.
 *
 * Dedup: `stale_notified_threshold_minutes` records the highest ladder step
 * already notified for; a tick only fires the next step once elapsed time
 * crosses it. Logging progress or changing stage resets both the baseline and
 * this counter (see repositories/assignments.ts).
 */
export async function checkStaleAssignments(now: Date): Promise<void> {
  const candidates = await listFirstDeliverableAssignments();

  for (const a of candidates) {
    const baselineMs = Math.max(new Date(a.stageEnteredAt).getTime(), new Date(a.progressUpdatedAt).getTime());
    const elapsedMinutes = (now.getTime() - baselineMs) / 60_000;

    // Build this assignment's full ladder including the concrete "next morning
    // 9am Dubai" step, expressed in minutes-since-baseline.
    const morningMinutes = Math.round((nextDubaiMorningMs(baselineMs) - baselineMs) / 60_000);
    const steps = [...LADDER_MINUTES, morningMinutes].filter((m) => m > 0).sort((x, y) => x - y);

    // Highest ladder step we've now passed.
    const crossed = steps.filter((m) => elapsedMinutes >= m).pop();
    if (crossed === undefined) continue;
    if (crossed <= a.staleNotifiedThresholdMinutes) continue;

    const project = await findProjectById(a.projectId);
    if (!project) continue;

    await markStaleNotified(a.id, crossed);

    const label = thresholdLabel(crossed);
    // Recipients: deliverer + PL + the PL's-team manager(s), de-duped.
    const pl = await findPersonById(a.projectPlId);
    const deliverer = await findPersonById(a.delivererId);
    const managerIds = pl?.teamId ? (await managersOfTeam(pl.teamId, a.projectPlId)).map((m) => m.id) : [];

    await notify({
      personId: a.delivererId,
      type: "stale_first_deliverable",
      title: "First Deliverable due",
      body: `${project.client} has been in First Deliverable ${label} with no progress logged.`,
      entityType: "assignment",
      entityId: a.id,
    });
    const escalation = new Set<string>([a.projectPlId, ...managerIds]);
    escalation.delete(a.delivererId); // never double-notify if PL is also the deliverer
    // Name the deliverer so a PL/manager with several stale deliverers on the
    // same project gets distinguishable alerts, not N identical "the assignee" ones.
    const who = deliverer?.name ?? "A deliverer";
    for (const personId of escalation) {
      await notify({
        personId,
        type: "stale_first_deliverable",
        title: "Deliverer's First Deliverable due",
        body: `${who} on ${project.client} has been in First Deliverable ${label} with no progress logged.`,
        entityType: "assignment",
        entityId: a.id,
      });
    }
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
