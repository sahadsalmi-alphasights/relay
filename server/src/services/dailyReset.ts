import { expireOutToLunch, resetAllEveningCoverage } from "../repositories/people";
import { dubaiDateKey, dubaiHour } from "../rules/time";
import { publish } from "../ws/hub";

// "Out to Lunch" auto-off window: a person returns to Free one hour after they
// switched it on (2026-07-29 — replaces the old fixed 16:00 daily reset).
const LUNCH_WINDOW_MS = 60 * 60 * 1000;

/**
 * Clock-driven automatic resets, run by the scheduler (not user actions):
 *
 *  - Out to Lunch expires 1 hour after each person switched it on — checked
 *    every tick, per person (not at a fixed time of day).
 *  - Evening coverage returns to its default (off) each morning — nobody
 *    carries last night's opt-in into a new day; they're re-asked at 18:00.
 *
 * The evening reset fires at most once per Dubai calendar day; the last-run
 * date is held in memory (a missed day after a restart just resets whenever
 * the next tick lands inside the window). The morning window is 04:00–08:00
 * (before the 08:00 working day) so an afternoon restart never clobbers an
 * evening-coverage opt-in made for that same night.
 */
let lastEveningResetDay: string | null = null;

export async function runDailyResets(now: Date): Promise<void> {
  const day = dubaiDateKey(now);
  const hour = dubaiHour(now);

  // Lunch: expire anyone who's been on it longer than the window. Every tick,
  // so auto-off lands within one scheduler interval of the hour mark.
  const lunchCleared = await expireOutToLunch(new Date(now.getTime() - LUNCH_WINDOW_MS).toISOString());
  if (lunchCleared > 0) {
    publish({ type: "people" });
    publish({ type: "capacity-ranking" });
  }

  if (hour >= 4 && hour < 8 && lastEveningResetDay !== day) {
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
