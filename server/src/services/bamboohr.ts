import { config } from "../config";

/**
 * BambooHR API client — read-only, used by the leave sync. The API key is a
 * credential (env only) and is never logged or returned to clients. All calls
 * are guarded: a BambooHR outage must never throw into the scheduler, it just
 * yields null and the sync skips that run.
 *
 * Auth is HTTP Basic with the API key as the username and any string as the
 * password (BambooHR's documented scheme).
 */

export interface TimeOffRequest {
  employeeId: string;
  typeName: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

/** True when both the API key and the company subdomain are set in env. */
export function hrConfigured(): boolean {
  return !!config.bamboohrApiKey && !!config.bamboohrSubdomain;
}

function authHeader(): string {
  // username = API key, password = anything (BambooHR ignores it).
  return "Basic " + Buffer.from(`${config.bamboohrApiKey}:x`).toString("base64");
}

function baseUrl(): string {
  return `https://api.bamboohr.com/api/gateway.php/${encodeURIComponent(config.bamboohrSubdomain)}/v1`;
}

async function getJson<T>(path: string): Promise<T | null> {
  if (!hrConfigured()) return null;
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      headers: { Authorization: authHeader(), Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Approved time-off requests overlapping [start, end] (YYYY-MM-DD). Each row
 * carries the leave-type NAME (e.g. "Vacation", "Sick") which the sync filters
 * on. Returns null on any failure (so the caller can distinguish "couldn't
 * reach BambooHR" from "nobody's out").
 */
export async function fetchApprovedTimeOff(start: string, end: string): Promise<TimeOffRequest[] | null> {
  const q = `/time_off/requests/?start=${start}&end=${end}&status=approved`;
  const raw = await getJson<
    { employeeId?: string | number; type?: { name?: string }; start?: string; end?: string }[]
  >(q);
  if (!raw) return null;
  return raw
    .filter((r) => r.employeeId != null && r.type?.name)
    .map((r) => ({
      employeeId: String(r.employeeId),
      typeName: String(r.type!.name),
      start: r.start ?? start,
      end: r.end ?? end,
    }));
}

/**
 * Map of BambooHR employeeId -> work email (lower-cased), from the company
 * directory. Time-off requests only carry employeeId, so this is how we join
 * BambooHR people to CapTracker people (by email). Returns null on failure.
 */
export async function fetchDirectoryEmails(): Promise<Map<string, string> | null> {
  const raw = await getJson<{ employees?: { id?: string | number; workEmail?: string | null }[] }>(
    "/employees/directory"
  );
  if (!raw?.employees) return null;
  const map = new Map<string, string>();
  for (const e of raw.employees) {
    if (e.id != null && e.workEmail) map.set(String(e.id), String(e.workEmail).trim().toLowerCase());
  }
  return map;
}
