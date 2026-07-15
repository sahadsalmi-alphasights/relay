import { PITCH_NO_CALLS_LOAD, STAGE_WEIGHT } from "./config";
import { poolWeight } from "./poolWeight";
import type { ExpertPool, ProjectType, Stage } from "./types";

export interface AssignmentProgress {
  goal: number;
  delivered: number;
  customDelivered: number;
}

/**
 * §5c — remaining(a). Custom profiles count toward the goal: a profile
 * sourced outside our system still counts as delivered, so both delivered
 * and customDelivered reduce what's remaining against the same `goal`.
 * custom_goal is not part of this formula — it exists only so a PL can see
 * the delivered/custom_delivered split, not as a second target to satisfy.
 */
export function remaining(a: AssignmentProgress): number {
  return Math.max(a.goal - (a.delivered + a.customDelivered), 0);
}

/** §5c — progress(a), for UI progress bars. */
export function progress(a: AssignmentProgress): number {
  if (a.goal === 0) return 0;
  return (a.delivered + a.customDelivered) / a.goal;
}

export interface WeightedAssignment extends AssignmentProgress {
  /** This assignment's own stage (§3/§8 domain change 8 — stage is per-deliverer, not per-project). */
  stage: Stage;
  projectExpertPool: ExpertPool;
  /**
   * §5c (domain change 4) — optional so every pre-existing call site (and
   * test) that doesn't pass these keeps behaving exactly as before: the flat-
   * load pin below only ever applies when both are explicitly given AND form
   * a no-calls-agreed Pitch.
   */
  projectType?: ProjectType;
  projectCallsN?: number;
}

/**
 * One assignment's contribution to its holder's load, at a given Dubai hour.
 *
 * §5c (domain change 4) — a Pitch with no calls agreed yet (callsN === 0)
 * pins load at a flat constant regardless of remaining work: a preview list
 * must not consume the deliverer's capacity proportionally. The moment the
 * client agrees to calls (callsN > 0), the project converts to normal
 * Strategy-style load — this reads live off the project's current callsN,
 * so nothing needs to explicitly "convert" it.
 */
export function assignmentLoad(a: WeightedAssignment, dubaiHourValue: number): number {
  if (a.projectType === "Pitch" && a.projectCallsN === 0) return PITCH_NO_CALLS_LOAD;
  return remaining(a) * STAGE_WEIGHT[a.stage] * poolWeight(a.projectExpertPool, dubaiHourValue);
}

/** §5c — load(person) = sum of every assignment's weighted remaining work. */
export function personLoad(assignments: WeightedAssignment[], dubaiHourValue: number): number {
  return assignments.reduce((sum, a) => sum + assignmentLoad(a, dubaiHourValue), 0);
}

export interface RemainingCountable extends AssignmentProgress {
  projectType?: ProjectType;
  projectCallsN?: number;
}

/**
 * §5d — "free" is judged on raw remaining profiles: the unweighted sum of
 * remaining(a) across a person's assignments, ignoring stage/pool weight
 * entirely. Used only for the median comparison, never for load itself.
 *
 * A no-calls Pitch (callsN === 0) is excluded from this sum, same as it's
 * excluded from load: its profiles are pinned out of the load model
 * entirely, so counting them here would make someone carrying only a Pitch
 * read as busy when the app's own load model says they aren't (bug fix).
 */
export function personRawRemaining(assignments: RemainingCountable[]): number {
  return assignments.reduce((sum, a) => {
    if (a.projectType === "Pitch" && a.projectCallsN === 0) return sum;
    return sum + remaining(a);
  }, 0);
}
