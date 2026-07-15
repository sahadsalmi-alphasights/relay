import { STAGE_BAND_AMBER_MINUTES, STAGE_BAND_RED_MINUTES, STAGE_ORDER } from "./config";
import type { Stage } from "./types";

export function canAdvanceStage(stage: Stage): boolean {
  return STAGE_ORDER.indexOf(stage) < STAGE_ORDER.length - 1;
}

/** §6 — advancing sets stage_entered_at = now(); caller is responsible for that timestamp. */
export function advanceStage(stage: Stage): Stage {
  const i = STAGE_ORDER.indexOf(stage);
  if (i === STAGE_ORDER.length - 1) {
    throw new Error(`Cannot advance past the final stage (${stage}).`);
  }
  return STAGE_ORDER[i + 1];
}

export function canBackStage(stage: Stage): boolean {
  return STAGE_ORDER.indexOf(stage) > 0;
}

/** §6 — a "back a stage" action for mis-clicks. Same stage_entered_at reset as advancing. */
export function backStage(stage: Stage): Stage {
  const i = STAGE_ORDER.indexOf(stage);
  if (i === 0) {
    throw new Error(`Cannot go back before the first stage (${stage}).`);
  }
  return STAGE_ORDER[i - 1];
}

/**
 * §3/§8 (domain change 8) — stage lives on each assignment now, not the
 * project. A project's displayed stage is always computed as the earliest
 * among its assignments' stages, never stored. Null for a project with no
 * assignments yet (the open pool).
 */
export function earliestStage(stages: Stage[]): Stage | null {
  if (stages.length === 0) return null;
  return stages.reduce((earliest, s) => (STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(earliest) ? s : earliest));
}

export type StageBand = "green" | "amber" | "red";

/** §6 — elapsed-timer color banding: <30 green, 30-60 amber, 60+ red. */
export function stageBand(minutesInStage: number): StageBand {
  if (minutesInStage < STAGE_BAND_AMBER_MINUTES) return "green";
  if (minutesInStage < STAGE_BAND_RED_MINUTES) return "amber";
  return "red";
}
