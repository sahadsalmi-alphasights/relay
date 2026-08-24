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

/**
 * Interpret the HTTP status of a deliberately-invalid "create time-off request"
 * probe into a write-capability verdict. Pure (no I/O) so it's unit-testable.
 *  - 401 → auth rejected (bad key)
 *  - 403 → authenticated but NOT permitted to write time off (read-only token)
 *  - 400/409/422 → authorized to write; the empty probe payload was rejected at
 *    VALIDATION, which proves the token can create requests (nothing persisted)
 *  - 200/201 → write accepted (unexpected for the bogus id — treat as writable)
 *  - 404 → endpoint/employee not found; usually no write access / plan lacks it
 */
export function interpretWriteProbe(status: number): { canWrite: boolean; detail: string } {
  if (status === 401) return { canWrite: false, detail: "401 — API key not accepted." };
  if (status === 403) return { canWrite: false, detail: "403 Forbidden — this token is read-only; it cannot book time off. Booking needs a token whose BambooHR user has time-off edit rights." };
  if (status === 400 || status === 409 || status === 422)
    return { canWrite: true, detail: `${status} — the token IS authorized to create time-off requests (the empty probe payload was rejected at validation; no record was created).` };
  if (status === 200 || status === 201) return { canWrite: true, detail: `${status} — write authorized.` };
  if (status === 404) return { canWrite: false, detail: "404 — time-off write endpoint/employee not found; likely no write access or the plan doesn't expose it." };
  return { canWrite: false, detail: `Unexpected HTTP ${status} — treat as no confirmed write access.` };
}

/**
 * Owner diagnostics — SAFELY test whether the token can BOOK time off, without
 * creating a real request. Sends an intentionally-invalid create call (bogus
 * employee id 0 + empty body) so BambooHR rejects it at auth/validation before
 * any record is persisted, then interprets the status (see interpretWriteProbe).
 */
export async function diagnoseTimeOffWrite(actorEmail?: string): Promise<{ ok: boolean; canWrite?: boolean; status?: number; detail?: string; error?: string }> {
  let creds: { apiKey: string; subdomain: string } | null;
  try {
    creds = await getBambooCreds();
  } catch (e) {
    return { ok: false, error: `credential decryption failed (KMS/IAM?): ${e instanceof Error ? e.message : "unknown"}` };
  }
  if (!creds) return { ok: false, error: "BambooHR not configured — paste an API key + subdomain in Integrations." };

  // Probe against a REAL employee (the caller's own BambooHR record, matched by
  // email) so the request reaches the permission/validation layer. An empty body
  // then fails validation (400) if authorized, or 403 if not — without ever
  // creating a record. A placeholder id would just 404 (employee not found) and
  // tell us nothing about write permission.
  let empId: string | null = null;
  const dir = await fetchDirectoryEmails();
  if (dir && actorEmail) {
    const want = actorEmail.trim().toLowerCase();
    for (const [id, em] of dir) if (em === want) { empId = id; break; }
  }
  if (!empId) {
    return { ok: false, error: "Couldn't match your email to a BambooHR employee to test against — the probe needs a real employee record. (Directory unreachable, or your work email doesn't match BambooHR.)" };
  }

  try {
    const res = await fetch(`${baseUrl(creds.subdomain)}/employees/${encodeURIComponent(empId)}/time_off/request/`, {
      method: "PUT",
      headers: { Authorization: authHeader(creds.apiKey), Accept: "application/json", "Content-Type": "application/json" },
      body: "{}", // empty ⇒ rejected at validation before anything is created
    });
    const { canWrite, detail } = interpretWriteProbe(res.status);
    return { ok: true, canWrite, status: res.status, detail: `${detail} (tested against your own BambooHR record)` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error reaching BambooHR" };
  }
}

/** A BambooHR time-off type the user can request against. */
export interface TimeOffType { id: string; name: string; unit: string }

/** The company's time-off types (Vacation/Sick/…) with their unit (hours/days),
 *  so the booking form only offers real options. Null on failure. */
export async function fetchTimeOffTypes(): Promise<TimeOffType[] | null> {
  const raw = await getJson<{ timeOffTypes?: { id?: string | number; name?: string; units?: string }[] } | { id?: string | number; name?: string; units?: string }[]>(
    "/meta/time_off/types/"
  );
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : raw.timeOffTypes ?? [];
  return list
    .filter((t) => t.id != null && t.name)
    .map((t) => ({ id: String(t.id), name: String(t.name), unit: (t.units || "days").toLowerCase() }));
}

/** Look up a BambooHR employeeId by work email (from the directory). */
export async function findEmployeeIdByEmail(email: string): Promise<string | null> {
  const dir = await fetchDirectoryEmails();
  if (!dir) return null;
  const want = email.trim().toLowerCase();
  for (const [id, em] of dir) if (em === want) return id;
  return null;
}

/**
 * Create a time-off request in BambooHR as `requested` (enters the normal
 * approval chain — never auto-approved). `unit` picks a sensible per-day amount
 * (8 for hours, 1 for days). Returns a readable ok/error; the caller resolves
 * the employeeId (self-service = the signed-in user's own record).
 */
export async function createTimeOffRequest(
  employeeId: string,
  req: { start: string; end: string; timeOffTypeId: string; unit: string; note?: string; amount?: string }
): Promise<{ ok: boolean; status?: number; error?: string }> {
  let creds: { apiKey: string; subdomain: string } | null;
  try {
    creds = await getBambooCreds();
  } catch (e) {
    return { ok: false, error: `credential decryption failed (KMS/IAM?): ${e instanceof Error ? e.message : "unknown"}` };
  }
  if (!creds) return { ok: false, error: "BambooHR not configured." };
  // Per-day amount: the caller picks it (full/half day, or hours); fall back to
  // a sensible default from the type's unit (8 hours, or 1 day).
  const amountNum = req.amount && Number(req.amount) > 0 ? Number(req.amount) : req.unit === "hours" ? 8 : 1;
  const typeIdNum = Number(req.timeOffTypeId);
  const noteText = req.note?.trim() || "Requested via CapTracker";
  const body = JSON.stringify({
    status: "requested",
    start: req.start,
    end: req.end,
    // BambooHR expects a numeric type id; strings can 400.
    timeOffTypeId: Number.isFinite(typeIdNum) ? typeIdNum : req.timeOffTypeId,
    amount: amountNum,
    // Each note must declare who it's "from" (employee|manager) — the keyed
    // {employee: "..."} shape 400s with "Missing required from attribute".
    notes: [{ from: "employee", note: noteText }],
  });
  try {
    const res = await fetch(`${baseUrl(creds.subdomain)}/employees/${encodeURIComponent(employeeId)}/time_off/request/`, {
      method: "PUT",
      headers: { Authorization: authHeader(creds.apiKey), Accept: "application/json", "Content-Type": "application/json" },
      body,
    });
    if (res.status === 200 || res.status === 201) return { ok: true, status: res.status };
    // BambooHR returns validation detail in a HEADER, not the body.
    const hdr = res.headers.get("x-bamboohr-error-message") || res.headers.get("X-BambooHR-Error-Message");
    const txt = (await res.text().catch(() => "")).trim().slice(0, 200);
    const detail = hdr || txt;
    if (res.status === 403) return { ok: false, status: 403, error: "BambooHR rejected the write (403) — the token lost time-off edit permission." };
    return { ok: false, status: res.status, error: `BambooHR returned ${res.status}${detail ? `: ${detail}` : " (no detail provided)"}` };
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

/**
 * Owner diagnostics — time-off in [start, end], broken down so we can see WHY
 * the planner might be empty for a future quarter: total rows, how many are
 * approved vs pending (the sync only counts approved), and the earliest/latest
 * request dates actually returned (reveals a feed that truncates far-future
 * dates). Fetched WITHOUT the status filter so pending requests are visible.
 */
export async function diagnoseTimeOff(
  start: string,
  end: string
): Promise<{ ok: boolean; error?: string; count?: number; approved?: number; pending?: number; other?: number; earliest?: string | null; latest?: string | null }> {
  const r = await getJsonDetailed<{ start?: string; status?: { status?: string } | string }[]>(
    `/time_off/requests/?start=${start}&end=${end}`
  );
  if (!r.ok) return { ok: false, error: r.error };
  const rows = Array.isArray(r.data) ? r.data : [];
  const statusOf = (x: { status?: { status?: string } | string }) =>
    (typeof x.status === "string" ? x.status : x.status?.status ?? "").toLowerCase();
  let approved = 0,
    pending = 0,
    other = 0;
  const dates: string[] = [];
  for (const x of rows) {
    const st = statusOf(x);
    if (st === "approved") approved += 1;
    else if (st === "requested") pending += 1;
    else other += 1;
    if (x.start) dates.push(x.start);
  }
  dates.sort();
  return {
    ok: true,
    count: rows.length,
    approved,
    pending,
    other,
    earliest: dates[0] ?? null,
    latest: dates[dates.length - 1] ?? null,
  };
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
  end: string,
  location?: string | null
): Promise<{ ok: boolean; error?: string; count?: number; total?: number; location?: string | null; holidays?: { name: string; start: string; end: string }[] }> {
  const r = await getJsonDetailed<{ type?: string; name?: string; start?: string; end?: string }[]>(
    `/time_off/whos_out/?start=${start}&end=${end}`
  );
  if (!r.ok) return { ok: false, error: r.error };
  const rows = Array.isArray(r.data) ? r.data : [];
  const all = rows
    .filter((h) => h.type === "holiday")
    .map((h) => ({ name: h.name ?? "Holiday", start: h.start ?? "", end: h.end ?? h.start ?? "" }));
  const holidays = filterHolidaysByLocation(all, location);
  return { ok: true, count: holidays.length, total: all.length, location: location ?? null, holidays: holidays.slice(0, 50) };
}

/**
 * BambooHR's who's-out holiday feed is company-wide: every office's closures
 * come back together, with the office encoded in the NAME (e.g. "[DUB] …",
 * "London …", "LON …"). There's no structured location field, so we scope to a
 * single office by name-token match: keep a holiday when its name mentions the
 * office (full city name or its 3-letter abbreviation, case-insensitive). With
 * no location we return everything (legacy behaviour).
 */
export function filterHolidaysByLocation<T extends { name: string }>(holidays: T[], location?: string | null): T[] {
  const loc = (location ?? "").trim().toLowerCase();
  if (!loc) return holidays;
  const tokens = [loc, loc.slice(0, 3)].filter(Boolean);
  return holidays.filter((h) => {
    const name = h.name.toLowerCase();
    return tokens.some((t) => name.includes(t));
  });
}

/**
 * Approved time-off requests overlapping [start, end] (YYYY-MM-DD). Each row
 * carries the leave-type NAME (e.g. "Vacation", "Sick") which the sync filters
 * on. Returns null on any failure (so the caller can distinguish "couldn't
 * reach BambooHR" from "nobody's out").
 */
export async function fetchPlannedTimeOff(
  start: string,
  end: string,
  includePending = true
): Promise<TimeOffRequest[] | null> {
  // No status filter in the query — we classify client-side. The PLANNER wants
  // both approved AND requested (pending) bookings, because a submitted request
  // still means the person planned that time off. The live auto-Offline sync
  // passes includePending=false (approved-only) so a not-yet-approved request
  // can't flip someone's live status. Denied / canceled / superseded always drop.
  const q = `/time_off/requests/?start=${start}&end=${end}`;
  const raw = await getJson<
    { employeeId?: string | number; type?: { name?: string }; start?: string; end?: string; status?: { status?: string } | string }[]
  >(q);
  if (!raw) return null;
  const statusOf = (x: { status?: { status?: string } | string }) =>
    (typeof x.status === "string" ? x.status : x.status?.status ?? "").toLowerCase();
  const allowed = new Set(includePending ? ["approved", "requested"] : ["approved"]);
  return raw
    .filter((r) => r.employeeId != null && r.type?.name && allowed.has(statusOf(r)))
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
