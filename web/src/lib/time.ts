import type { ExpertPool } from "../api/types";

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

function toDubaiShifted(ms: number): Date {
  return new Date(ms + DUBAI_OFFSET_MS);
}

export function dubaiHour(ms: number): number {
  return toDubaiShifted(ms).getUTCHours();
}

export function dubaiMinute(ms: number): number {
  return toDubaiShifted(ms).getUTCMinutes();
}

export function isSunday(ms: number): boolean {
  return toDubaiShifted(ms).getUTCDay() === 0;
}

/**
 * Today's Dubai calendar date at the given Dubai hour, as a real UTC
 * instant (ms) — used to build the demo-clock override sent to the server,
 * so "preview 20:00" means the same instant everywhere, not just a label.
 */
export function demoInstantMs(nowMs: number, hour: number): number {
  const dateKey = dubaiDateKey(nowMs);
  const dubaiMidnightUtcMs = Date.parse(`${dateKey}T00:00:00Z`) - DUBAI_OFFSET_MS;
  return dubaiMidnightUtcMs + hour * 3600000;
}

export function dubaiDateKey(ms: number): string {
  const d = toDubaiShifted(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isAfterHours(ms: number): boolean {
  const h = dubaiHour(ms);
  return h < 8 || h >= 19;
}

export function poolWeight(pool: ExpertPool, hour: number): number {
  const late = hour >= 15;
  switch (pool) {
    case "Global":
    case "EU & MEA & India":
      return 1;
    case "AUS / NZ / Sing / JP":
      return late ? 0 : 2;
    case "US only":
      return late ? 2 : 0;
  }
}

export function poolState(pool: ExpertPool, hour: number): "dormant" | "live" | "normal" {
  const w = poolWeight(pool, hour);
  return w === 0 ? "dormant" : w === 2 ? "live" : "normal";
}

/** Next N upcoming Sundays (today included if it is one), as Dubai-local yyyy-mm-dd keys. */
export function upcomingSundays(nowMs: number, n: number): string[] {
  const shifted = toDubaiShifted(nowMs);
  const diff = (7 - shifted.getUTCDay()) % 7;
  const first = new Date(shifted.getTime() + diff * 86400000);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(first.getTime() + i * 7 * 86400000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

export function prettyDateKey(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function fmtElapsed(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export type StageBand = "t-green" | "t-amber" | "t-red";

export function timerClass(ms: number): StageBand {
  const m = ms / 60000;
  if (m < 30) return "t-green";
  if (m < 60) return "t-amber";
  return "t-red";
}
