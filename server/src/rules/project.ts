import { dubaiDateKey } from "./time";
import type { PersonStatus } from "./types";

/**
 * §8.1 (corrected) — "delivered, not yet sold — chase client". Profiles and
 * calls are different units, so this is never a numeric comparison between
 * them: it flags "we've sourced experts for this client but they haven't
 * booked the calls yet."
 */
export function needsChaseClient(totalDelivered: number, callsSold: number, callsN: number): boolean {
  return totalDelivered > 0 && callsSold < callsN;
}

/**
 * §8.1 — calls_sold is manual for now (a PL types it in); this flags a
 * project whose calls_sold hasn't been touched yet today (Asia/Dubai
 * calendar day), so the PL board can nudge for an end-of-day update.
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
