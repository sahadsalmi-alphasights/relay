import { getCoverageSettings } from "../repositories/coverageSettings";
import { expireOutToLunch, resetAllEveningCoverage } from "../repositories/people";
import { dubaiDateKey, dubaiMinuteOfDay } from "../rules/time";
import { publish } from "../ws/hub";

/**
 * Clock-driven automatic resets, run by the scheduler (not user actions). All
 * timings come from coverage_settings (Settings → Coverage), so they're
 * owner-tunable with no redeploy — defaults match the old hardcoded values:
 *
 *  - Out to Lunch expires `lunchAutoOffMin` minutes after each person switched
 *    it on — checked every tick, per person (not at a fixed time of day).
 *  - Evening coverage returns to off each morning inside the reset window
 *    (`eveningResetStartMin`–`eveningResetEndMin`), so nobody carries last
 *    night's opt-in into a new day.
 *
 * The evening reset fires at most once per Dubai calendar day; the last-run
 * date is held in memory (a missed day after a restart just resets whenever
 * the next tick lands inside the window). The window sits before the working
 * day so an afternoon restart never clobbers an opt-in made for that night.
 */
let lastEveningResetDay: string | null = null;

export async function runDailyResets(now: Date): Promise<void> {
  const day = dubaiDateKey(now);
  const minuteOfDay = dubaiMinuteOfDay(now);
  const settings = await getCoverageSettings();

  // Lunch: expire anyone who's been on it longer than the configured window.
  // Every tick, so auto-off lands within one scheduler interval of the mark.
  const cutoffMs = now.getTime() - settings.lunchAutoOffMin * 60_000;
  const lunchCleared = await expireOutToLunch(new Date(cutoffMs).toISOString());
  if (lunchCleared > 0) {
    publish({ type: "people" });
    publish({ type: "capacity-ranking" });
  }

  if (
    minuteOfDay >= settings.eveningResetStartMin &&
    minuteOfDay < settings.eveningResetEndMin &&
    lastEveningResetDay !== day
  ) {
    lastEveningResetDay = day;
    const n = await resetAllEveningCoverage();
    if (n > 0) {
      publish({ type: "people" });
      publish({ type: "capacity-ranking" });
    }
  }
}

/** `.unref()`'d so it never keeps the process (or a test) alive on its own. */
export function startDailyResetScheduler(intervalMs = 5 * 60_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    runDailyResets(new Date()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("daily reset scheduler tick failed", err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
