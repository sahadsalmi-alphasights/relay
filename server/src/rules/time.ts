import {
  AFTER_HOURS_START_HOUR,
  DUBAI_UTC_OFFSET_HOURS,
  WORKING_DAY_START_HOUR,
} from "./config";

function toDubaiShifted(instant: Date): Date {
  return new Date(instant.getTime() + DUBAI_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

/** Hour of day (0-23) in Asia/Dubai for the given instant. */
export function dubaiHour(instant: Date): number {
  return toDubaiShifted(instant).getUTCHours();
}

/**
 * The epoch-ms instant of `hour`:00 Asia/Dubai on the calendar day AFTER the
 * given instant's Dubai date. Used by the First-Deliverable-due ladder for its
 * final "next morning 9am" reminder. Dubai has no DST, so the fixed offset is
 * exact.
 */
export function nextDubaiMorningMs(fromMs: number, hour = 9): number {
  const shifted = toDubaiShifted(new Date(fromMs)); // Dubai wall-clock expressed as a UTC Date
  const nextDayWallUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    hour,
    0,
    0
  );
  // Convert that Dubai wall-clock back to a real UTC instant.
  return nextDayWallUtc - DUBAI_UTC_OFFSET_HOURS * 60 * 60 * 1000;
}

/** Minutes since midnight (0–1439) in Asia/Dubai — matches coverage_settings' minute-of-day fields. */
export function dubaiMinuteOfDay(instant: Date): number {
  const d = toDubaiShifted(instant);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 0 = Sunday, matching Date#getUTCDay, evaluated in Asia/Dubai. */
export function dubaiWeekday(instant: Date): number {
  return toDubaiShifted(instant).getUTCDay();
}

/** §4 Rule 2: is_sunday = the calendar date in Asia/Dubai, full local day. */
export function isSunday(instant: Date): boolean {
  return dubaiWeekday(instant) === 0;
}

/** YYYY-MM-DD calendar date in Asia/Dubai, for matching against sunday_rota.rota_date. */
export function dubaiDateKey(instant: Date): string {
  const d = toDubaiShifted(instant);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The current calendar month in Asia/Dubai, as a half-open UTC range
 * [start, end) plus its "YYYY-MM" key. Used by the monthly market-share
 * pulse so "this month" follows the Dubai calendar, not the server's UTC one
 * (a project created at 01:00 Dubai on the 1st belongs to the new month).
 */
export function dubaiMonthRange(instant: Date): { startIso: string; endIso: string; monthKey: string } {
  const d = toDubaiShifted(instant);
  const year = d.getUTCFullYear();
  const monthIdx = d.getUTCMonth(); // 0-based
  const offsetMs = DUBAI_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  // Dubai-local midnight on the 1st, expressed back in UTC.
  const startUtcMs = Date.UTC(year, monthIdx, 1) - offsetMs;
  const endUtcMs = Date.UTC(year, monthIdx + 1, 1) - offsetMs;
  return {
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString(),
    monthKey: `${year}-${String(monthIdx + 1).padStart(2, "0")}`,
  };
}

/** §4 Rule 3: after hours = before 08:00 or after/at 19:00 Dubai time. */
export function isAfterHours(instant: Date): boolean {
  const hour = dubaiHour(instant);
  return hour < WORKING_DAY_START_HOUR || hour >= AFTER_HOURS_START_HOUR;
}
