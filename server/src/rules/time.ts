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

/** §4 Rule 3: after hours = before 08:00 or after/at 19:00 Dubai time. */
export function isAfterHours(instant: Date): boolean {
  const hour = dubaiHour(instant);
  return hour < WORKING_DAY_START_HOUR || hour >= AFTER_HOURS_START_HOUR;
}
