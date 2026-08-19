import { fetchPlannedTimeOff, fetchDirectoryEmails, hrConfigured } from "./bamboohr";

export interface VacationBlock {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  type: string; // BambooHR leave-type name
}

/**
 * Approved time-off for everyone in [from, to], keyed by lower-cased work
 * email — the join key back to CapTracker people. Sourced entirely from
 * BambooHR (the system of record). Returns an empty map when BambooHR isn't
 * configured or is unreachable, so the planner still renders (just without
 * vacation blocks) rather than erroring.
 */
export async function vacationsByEmail(from: string, to: string): Promise<Map<string, VacationBlock[]>> {
  const out = new Map<string, VacationBlock[]>();
  if (!(await hrConfigured())) return out;

  const [requests, directory] = await Promise.all([fetchPlannedTimeOff(from, to), fetchDirectoryEmails()]);
  if (!requests || !directory) return out;

  for (const r of requests) {
    const email = directory.get(r.employeeId);
    if (!email) continue;
    const list = out.get(email) ?? [];
    list.push({ start: r.start, end: r.end, type: r.typeName });
    out.set(email, list);
  }
  return out;
}
