import type { Stage } from "./types";

// §5a — placeholder constants supplied by the product owner, expected to be
// tuned. Kept in this one module; nothing else in the rules engine hardcodes
// these numbers.
export const SMALL_CALLS = 2;
export const MULT_SMALL = 3; // N <= SMALL_CALLS -> goal = N * MULT_SMALL
export const MULT_LARGE = 2; // N >  SMALL_CALLS -> goal = N * MULT_LARGE

// §5a (domain change 4) — Due Diligence: N is typically high and sourcing is
// harder, so it's intentionally heavier than Strategy at the same N.
export const DD_MULT = 3; // goal = N * DD_MULT, regardless of N's size

// §5a (domain change 4) — a Pitch with no calls agreed yet (N = 0): a small
// preview list, not sized off calls at all.
export const PITCH_NO_CALLS_GOAL = 8; // "5-10 profiles, default 8"
export const PITCH_NO_CALLS_STAFF = 1;
// §5c (domain change 4) — while a Pitch has zero calls agreed, its load is
// pinned flat so it never consumes capacity proportionally to remaining work.
export const PITCH_NO_CALLS_LOAD = 1;

// §5c
export const STAGE_WEIGHT: Record<Stage, number> = {
  "First Deliverable": 2,
  "Second Deliverable": 1,
  "Hail Mary": 0.5,
  Selling: 0,
};

// §6 — ordered stage list; index also drives advance/back.
export const STAGE_ORDER: Stage[] = [
  "First Deliverable",
  "Second Deliverable",
  "Hail Mary",
  "Selling",
];

// Asia/Dubai working hours (§4). UAE has used a fixed UTC+4 offset with no
// DST since 1972, so a plain arithmetic shift is exact — no tz database
// lookup needed.
export const DUBAI_UTC_OFFSET_HOURS = 4;
export const WORKING_DAY_START_HOUR = 8;
export const AFTER_HOURS_START_HOUR = 19;

// §4 pool-weight table boundary.
export const POOL_WEIGHT_SWITCH_HOUR = 15;

// §6 elapsed-timer color bands, in minutes.
export const STAGE_BAND_AMBER_MINUTES = 30;
export const STAGE_BAND_RED_MINUTES = 60;
