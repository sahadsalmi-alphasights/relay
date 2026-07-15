import { DD_MULT, MULT_LARGE, MULT_SMALL, PITCH_NO_CALLS_GOAL, PITCH_NO_CALLS_STAFF, SMALL_CALLS } from "./config";
import type { ProjectType } from "./types";

/**
 * §5a (domain change 4) — project type changes the formula, not just the
 * label:
 * - Pitch at N=0 (no calls agreed yet): a flat small preview goal, not sized
 *   off calls at all. Once N is set > 0, a Pitch converts to Strategy's math
 *   below (this function doesn't need to special-case "N>0 Pitch" — it falls
 *   through to the same branch Strategy uses).
 * - Due Diligence: N is typically high and sourcing is harder, so it's
 *   always N * DD_MULT — intentionally heavier than Strategy at the same N.
 * - Strategy (and Pitch once N > 0): N<=2 -> N*3, N>=3 -> N*2.
 */
export function suggestGoal(callsN: number, projectType: ProjectType): number {
  if (projectType === "Pitch" && callsN === 0) return PITCH_NO_CALLS_GOAL;
  if (projectType === "Due Diligence") return callsN * DD_MULT;
  const multiplier = callsN <= SMALL_CALLS ? MULT_SMALL : MULT_LARGE;
  return callsN * multiplier;
}

export interface SuggestedStaffing {
  delivererCount: number;
}

/**
 * §5b (domain change 4, bug fix) — one deliverer per 2 calls for Strategy,
 * Due Diligence, and a Pitch once N > 0 (same staffing formula across all
 * three — only the goal formula differs by type). A Pitch at N=0 staffs
 * exactly 1.
 *
 * N=1 and N=2 are called out explicitly rather than falling into
 * ceil(N/2): N=1 -> 1 deliverer, N=2 -> 2 deliverers (NOT 1 — two calls'
 * worth of sourcing is a two-person job even though ceil(2/2) is 1).
 * N>=3 uses the divide-by-2 rule.
 */
export function suggestStaffing(callsN: number, projectType: ProjectType): SuggestedStaffing {
  if (projectType === "Pitch" && callsN === 0) return { delivererCount: PITCH_NO_CALLS_STAFF };
  if (callsN === 1) return { delivererCount: 1 };
  if (callsN === 2) return { delivererCount: 2 };
  return { delivererCount: Math.ceil(callsN / 2) };
}

/**
 * §5 (domain change 7) — custom_goal is always derived from goal, never set
 * by hand: custom_goal = IF(goal<=1, 0, MAX(ROUNDUP(goal*0.33), 1)). It's
 * part of the goal, not additional to it — a goal of 10 means 10 profiles
 * total, of which ~4 should ideally be custom-sourced.
 */
export function computeCustomGoal(goal: number): number {
  if (goal <= 1) return 0;
  return Math.max(Math.ceil(goal * 0.33), 1);
}
