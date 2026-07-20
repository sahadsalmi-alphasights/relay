import { dubaiDateKey } from "./time";
import type { PersonStatus, ProjectStatus } from "./types";

/**
 * Project lifecycle — archived goes quiet: no load, no calls-sold nudge, no
 * chase-client flag, no stale-first-deliverable ping. (Batch S removed
 * 'idle', the other formerly-quiet status.) The single source of truth,
 * referenced by candidates.ts (load query), assignments.ts (stale scheduler
 * query), and routes/projects.ts (withProjectFlags) — those three can't
 * literally call this function (two are SQL WHERE clauses evaluated before
 * any JS sees a row), so they inline the equivalent `status <> 'archived'`,
 * but this is the definition they're each keeping in sync with.
 */
export function isProjectLifecycleQuiet(status: ProjectStatus): boolean {
  return status === "archived";
}

/**
 * §8.1 (corrected) — "delivered, not yet sold — chase client". Profiles and
 * calls are different units, so this is never a numeric comparison between
 * them: it flags "we've sourced experts for this client but they haven't
 * booked the calls yet."
 *
 * Angles — this is a per-angle fact (each angle has its own delivered/sold
 * count), never computed from project-wide sums: a resolved angle's
 * delivered count could paper over a genuinely-lagging one if you summed
 * first. The route layer calls this once per angle and ORs the results.
 */
export function needsChaseClient(totalDelivered: number, callsSold: number, callsN: number): boolean {
  return totalDelivered > 0 && callsSold < callsN;
}

/**
 * §8.1 — calls_sold is manual for now (a PL types it in); this flags an
 * angle whose calls_sold hasn't been touched yet today (Asia/Dubai calendar
 * day), so the PL board can nudge for an end-of-day update. Per-angle, same
 * reasoning as needsChaseClient above — the route layer ORs across angles.
 */
export function needsCallsSoldUpdateToday(callsSoldUpdatedAt: string | Date, now: Date): boolean {
  return dubaiDateKey(new Date(callsSoldUpdatedAt)) !== dubaiDateKey(now);
}

/**
 * §4 Rule 1 / §7b — the app doesn't need to auto-reassign outstanding work
 * when someone goes non-Available, but it should warn the manager making
 * that change and point them at the swap flow.
 */
export function shouldWarnOnStatusChange(
  newStatus: PersonStatus,
  outstandingProfiles: number
): boolean {
  return newStatus !== "Available" && outstandingProfiles > 0;
}
