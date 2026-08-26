import type { Stage } from "./types";

/**
 * Batch (notifications) — a deliverer's goal-change request now carries a
 * *delivery-stage* target, not a project lifecycle status. The picker offers
 * the four real stages plus "Archive" — a deliverer's way to take the project
 * off their board. When accepted it closes delivery (off every deliverer's
 * board) but keeps the project live on the PL board; it does NOT archive the
 * whole project. A true project archive stays a PL/manager action.
 * "Selling" is stored/validated as-is but shown to humans as "Admin" (the same
 * display rename the web STAGE_OPTIONS / format.stageLabel already applies).
 */
export const GOAL_CHANGE_TARGETS = [
  "First Deliverable",
  "Second Deliverable",
  "Hail Mary",
  "Selling",
  "Archive",
] as const;

export type GoalChangeTarget = (typeof GOAL_CHANGE_TARGETS)[number];

export function isGoalChangeTarget(v: string): v is GoalChangeTarget {
  return (GOAL_CHANGE_TARGETS as readonly string[]).includes(v);
}

/** "Archive" is not a Stage — the rest are. */
export function isStageTarget(v: string): v is Stage {
  return v !== "Archive" && isGoalChangeTarget(v);
}

/** Human label for a target — only "Selling" differs ("Admin"). */
export function goalChangeTargetLabel(t: string): string {
  return t === "Selling" ? "Admin" : t;
}
