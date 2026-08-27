/**
 * Lunch timing — turns the stored `out_to_lunch_since` timestamp plus the
 * org's `lunchAutoOffMin` window into "how long they've been out" and "how
 * long until they're back", computed live against the ticking clock (nowMs)
 * so the countdown updates without a refetch — same approach as the stage
 * timers. Returns null when the person isn't at lunch.
 */
export interface LunchTiming {
  elapsedMin: number;
  remainingMin: number;
  /** Past the auto-off window — they're due back any moment. */
  overdue: boolean;
}

export function lunchTiming(
  since: string | null | undefined,
  autoOffMin: number,
  nowMs: number
): LunchTiming | null {
  if (!since) return null;
  const start = new Date(since).getTime();
  if (Number.isNaN(start)) return null;
  const elapsedMin = Math.max(0, Math.round((nowMs - start) / 60000));
  const remainingMin = Math.round(autoOffMin - elapsedMin);
  return { elapsedMin, remainingMin, overdue: remainingMin <= 0 };
}

/** "41m" or "1h 08m". */
export function fmtDur(min: number): string {
  const m = Math.max(0, min);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "Out 41m · ~19m left" while inside the window; "Out 1h 08m · overdue" past it. */
export function lunchLabel(t: LunchTiming): string {
  return t.overdue ? `Out ${fmtDur(t.elapsedMin)} · overdue` : `Out ${fmtDur(t.elapsedMin)} · ~${fmtDur(t.remainingMin)} left`;
}
