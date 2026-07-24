import { isAfterHours } from "./time";
import type { PersonStatus } from "./types";

export interface EligibilityPerson {
  id: string;
  status: PersonStatus;
  eveningCoverage: boolean;
  /** "Out to Lunch" — optional so pure-rule tests that predate it stay valid; callers pass the live column. */
  outToLunch?: boolean;
}

export interface EligibilityContext {
  now: Date;
}

export type IneligibleReason =
  | "not_available"
  | "out_to_lunch"
  | "no_evening_coverage";

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: IneligibleReason };

/**
 * What makes someone OFFLINE (ineligible), revised 2026-07-23. Two causes only:
 *   1. A manager set their status to Sick / On vacation / Offline.
 *   2. Their evening-coverage toggle is off AND it's after 7pm Dubai.
 * The Sunday-rota rule was removed as an eligibility gate — the only remaining
 * *block* on an otherwise-online person is a live First Deliverable on a
 * Strategy/DD project (see applyFirstDeliverableBlock in matching.ts). Pool
 * weight is never an eligibility rule, only a load multiplier (poolWeight.ts).
 */
export function isEligible(
  person: EligibilityPerson,
  context: EligibilityContext
): EligibilityResult {
  // Status. Sick / On vacation / Offline are never eligible.
  if (person.status !== "Available") {
    return { eligible: false, reason: "not_available" };
  }

  // "Out to Lunch" — a self-serve live toggle, same spirit as evening
  // coverage: while on, no new work is allocated (existing assignments stay).
  // Unlike a non-Available status, the person still appears on the Capacity
  // Ranking, flagged as "Lunch".
  if (person.outToLunch) {
    return { eligible: false, reason: "out_to_lunch" };
  }

  // Evening coverage — a live, self-owned toggle: off + after 7pm = offline.
  if (isAfterHours(context.now) && !person.eveningCoverage) {
    return { eligible: false, reason: "no_evening_coverage" };
  }

  return { eligible: true };
}
