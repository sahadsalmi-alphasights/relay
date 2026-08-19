import { config } from "../config";
import { getHrStoredCredentials } from "../repositories/hrIntegrationSettings";
import { secretCrypto } from "../crypto/secretCrypto";

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

/**
 * Resolve the live BambooHR credentials. Preference order:
 *  1. Encrypted key pasted in the Integrations UI (decrypted via secretCrypto —
 *     GCP KMS in prod), with the subdomain stored alongside it.
 *  2. Env fallback (BAMBOOHR_API_KEY / BAMBOOHR_SUBDOMAIN) — legacy / bootstrap.
 * Returns null when neither yields a usable pair. Decryption failures (e.g. a
 * KMS/IAM problem) surface as a thrown error to the detailed path, and as
 * "null" (not configured) to the swallowing path.
 */
export async function getBambooCreds(): Promise<{ apiKey: string; subdomain: string } | null> {
  const stored = await getHrStoredCredentials();
  const subdomain = (stored.subdomain || config.bamboohrSubdomain || "").trim();
  if (stored.apiKeyCiphertext) {
    const apiKey = (await secretCrypto().decrypt(stored.apiKeyCiphertext)).trim();
    if (apiKey && subdomain) return { apiKey, subdomain };
  }
  if (config.bamboohrApiKey && subdomain) return { apiKey: config.bamboohrApiKey, subdomain };
  return null;
}

/** True when a usable API key + subdomain can be resolved (stored or env). */
export async function hrConfigured(): Promise<boolean> {
  try {
    return !!(await getBambooCreds());
  } catch {
    return false;
  }
}

function authHeader(apiKey: string): string {
  // username = API key, password = anything (BambooHR ignores it).
  return "Basic " + Buffer.from(`${apiKey}:x`).toString("base64");
}

function baseUrl(subdomain: string): string {
  return `https://api.bamboohr.com/api/gateway.php/${encodeURIComponent(subdomain)}/v1`;
}

async function getJson<T>(path: string): Promise<T | null> {
  let creds: { apiKey: string; subdomain: string } | null;
  try {
    creds = await getBambooCreds();
  } catch {
    return null;
  }
  if (!creds) return null;
  try {
    const res = await fetch(`${baseUrl(creds.subdomain)}${path}`, {
      headers: { Authorization: authHeader(creds.apiKey), Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Like getJson but keeps the failure reason (HTTP status / network error) for
 * the owner diagnostics — the normal path deliberately swallows errors so a
 * BambooHR blip never breaks the app; diagnostics needs to SEE them.
 */
async function getJsonDetailed<T>(path: string): Promise<{ ok: boolean; error?: string; data?: T }> {
  let creds: { apiKey: string; subdomain: string } | null;
  try {
    creds = await getBambooCreds();
  } catch (e) {
    return { ok: false, error: `credential decryption failed (KMS/IAM?): ${e instanceof Error ? e.message : "unknown"}` };
  }
  if (!creds) return { ok: false, error: "BambooHR not configured — paste a key in the Integrations tab (or set BAMBOOHR_* env)" };
  try {
    const res = await fetch(`${baseUrl(creds.subdomain)}${path}`, {
      headers: { Authorization: authHeader(creds.apiKey), Accept: "application/json" },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error reaching BambooHR" };
  }
}

/** Owner diagnostics — directory reachability + how many people carry a work email. */
export async function diagnoseDirectory(): Promise<{ ok: boolean; error?: string; employees?: number; withEmail?: number }> {
  const r = await getJsonDetailed<{ employees?: { workEmail?: string | null }[] }>("/employees/directory");
  if (!r.ok) return { ok: false, error: r.error };
  const employees = r.data?.employees ?? [];
  return { ok: true, employees: employees.length, withEmail: employees.filter((e) => e.workEmail).length };
}

/** Owner diagnostics — approved time-off in [start, end]: reachable + how many rows. */
export async function diagnoseTimeOff(start: string, end: string): Promise<{ ok: boolean; error?: string; count?: number }> {
  const r = await getJsonDetailed<unknown[]>(`/time_off/requests/?start=${start}&end=${end}&status=approved`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, count: Array.isArray(r.data) ? r.data.length : 0 };
}

/**
 * Owner diagnostics — reads the company **public holidays** BambooHR reports
 * for [start, end]. BambooHR's who's-out feed returns both time-off and
 * holiday entries; we keep the `type: "holiday"` ones. This is the "read the
 * Dubai office public holidays from BambooHR" test — it proves the feed is
 * reachable and shows exactly which holidays (name + date) would flow in.
 */
export async function diagnoseHolidays(
  start: string,
  end: string
): Promise<{ ok: boolean; error?: string; count?: number; holidays?: { name: string; start: string; end: string }[] }> {
  const r = await getJsonDetailed<{ type?: string; name?: string; start?: string; end?: string }[]>(
    `/time_off/whos_out/?start=${start}&end=${end}`
  );
  if (!r.ok) return { ok: false, error: r.error };
  const rows = Array.isArray(r.data) ? r.data : [];
  const holidays = rows
    .filter((h) => h.type === "holiday")
    .map((h) => ({ name: h.name ?? "Holiday", start: h.start ?? "", end: h.end ?? h.start ?? "" }));
  return { ok: true, count: holidays.length, holidays: holidays.slice(0, 50) };
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
