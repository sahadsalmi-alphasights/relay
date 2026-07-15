import { isAfterHours, isSunday } from "./time";
import type { PersonStatus } from "./types";

export interface EligibilityPerson {
  id: string;
  status: PersonStatus;
  eveningCoverage: boolean;
}

export interface EligibilityContext {
  now: Date;
  /** Person ids rostered on sunday_rota for today's Dubai calendar date. Only
   * consulted when `now` falls on a Dubai Sunday. */
  sundayRotaPersonIds: ReadonlySet<string>;
}

export type IneligibleReason =
  | "not_available"
  | "not_on_sunday_rota"
  | "no_evening_coverage";

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: IneligibleReason };

/**
 * §4 — the four availability rules, kept deliberately separate (do not fuse
 * them). Pool weight (Rule 4) never appears here: it is not an eligibility
 * rule, only a load multiplier (see poolWeight.ts).
 */
export function isEligible(
  person: EligibilityPerson,
  context: EligibilityContext
): EligibilityResult {
  // Rule 1 — status. Sick / On vacation / Offline are never eligible.
  if (person.status !== "Available") {
    return { eligible: false, reason: "not_available" };
  }

  // Rule 2 — Sunday rota is a schedule, not a preference. Only checked on a
  // Dubai Sunday; on any other day it imposes no restriction at all.
  if (isSunday(context.now) && !context.sundayRotaPersonIds.has(person.id)) {
    return { eligible: false, reason: "not_on_sunday_rota" };
  }

  // Rule 3 — evening coverage is a live, self-owned toggle, checked only
  // after hours. Stacks with (does not replace) Rule 2.
  if (isAfterHours(context.now) && !person.eveningCoverage) {
    return { eligible: false, reason: "no_evening_coverage" };
  }

  return { eligible: true };
}
