import { insertAuditLog } from "../repositories/auditLog";
import { deriveInstanceKey, findInstanceByTuple } from "../repositories/instances";
import { bulkCreatePeopleWithBu, bulkSetBusinessUnit, emailBusinessUnitMap } from "../repositories/people";

/** One directory row, normalised to the (city, department, board?) tuple the
 *  instance model uses. Produced by a directory source (e.g. Okta). */
export interface DirectoryPerson {
  employeeId: string; // stable id from the source (email for Okta)
  email: string; // lower-cased ("" if none)
  name: string;
  location: string | null; // → instance city
  department: string | null; // → instance department
  board: string | null; // whiteboard_number → instance board
}

/**
 * Seed instances and users from a directory source (Okta), using the SAME
 * derivation Okta uses at login: each person's (city, department, board?)
 * resolves to an isolated instance via deriveInstanceKey (board =
 * whiteboard_number), and their home instance is set with the bulk equivalents
 * of setPersonBusinessUnit. The person_home_instance trigger adds membership.
 *
 * Source-agnostic: callers pass a fetcher that returns DirectoryPerson rows (or
 * null on failure), so the same preview/apply logic works for any directory.
 *
 * Two entry points, on purpose: previewImport() is read-only (nothing is
 * written) so an owner can see exactly what a run would create before doing it;
 * applyImport() performs it, idempotently (re-running only fills gaps).
 */

/** A directory source: resolves to the roster, or null if it couldn't be read. */
export type DirectorySource = () => Promise<DirectoryPerson[] | null>;

export interface ImportGroup {
  city: string;
  department: string;
  board: string | null;
  key: string | null; // existing instance key, or null if it would be created
  existing: boolean;
  people: number; // BambooHR employees in this office with a usable email
}

export interface ImportPreview {
  ok: boolean;
  error?: string;
  totalEmployees?: number;
  skippedNoEmail?: number;
  skippedNoTuple?: number;
  skippedNotAllowed?: number; // real office, not on the approved list
  withTuple?: number;
  withBoard?: number; // usable people carrying a board/whiteboard value
  groups?: ImportGroup[];
  newInstances?: number;
  existingInstances?: number;
  matchedUsers?: number; // already exist in CapTracker
  newUsers?: number; // would be created
}

interface Classified {
  usable: DirectoryPerson[]; // has email + city + department, and an allowed office
  skippedNoEmail: number;
  skippedNoTuple: number;
  skippedNotAllowed: number; // real office, but not on the approved list below
}

/**
 * Approved office taxonomy — the ONLY (location → departments) combos we seed.
 * Okta returns far more (Remote, Technology and Strategy, etc.); anything not
 * listed here is skipped. Keyed on the exact (location, department) pair
 * because departments intentionally cross-prefix (e.g. "HK SC - GROWTH - SEAA"
 * under Tokyo, "NY - Executive Partnerships" under San Francisco). A board
 * (whiteboard_number) under an allowed department is still imported.
 */
const OKTA_OFFICE_ALLOWLIST: Record<string, string[]> = {
  Tokyo: ["HK SC - GROWTH - SEAA", "TYO - CAP", "TYO - PE", "TYO SC - BCG", "TYO SC - GROWTH", "TYO SC - GROWTH - CORPORATE STRATEGY", "TYO SC - McKinsey"],
  Hamburg: ["HAM - Executive Partnerships", "HAM - PE", "HAM SC - GROWTH", "HAM SC - MBB"],
  "San Francisco": ["NY - Executive Partnerships", "SF PE"],
  Shanghai: ["SH - PE", "SH CORP", "SH SC - Consulting"],
  London: ["LON - AlphaGlobal", "LON - Executive Partnerships", "LON - Research", "LON - SC", "LON - Surveys", "LON CAP", "LON CORP", "LON PE"],
  "New York": ["NY - Executive Partnerships", "NY - Research", "NY - Surveys", "NY CAP", "NY CORP", "NY CORP International", "NY PE", "NY SC - BCG", "NY SC - Bain", "NY SC - Growth", "NY SC - McKinsey"],
  "Hong Kong": ["Asia Surveys", "HK - CAP", "HK - CORP", "HK - Executive Partnerships", "HK - India Consulting", "HK - PE", "HK - Research", "HK SC - GROWTH - SEAA", "HK SC BCG - SEAA", "HK SC Bain - SEAA"],
  Dubai: ["DUB - Consulting", "DUB - Non-Consulting"],
  Seoul: ["SEL - CORP", "SEL - PE", "SEL SC - BCG", "SEL SC - Bain", "SEL SC - Growth", "SEL SC - McKinsey"],
};
const ALLOWED_OFFICES = new Set<string>(
  Object.entries(OKTA_OFFICE_ALLOWLIST).flatMap(([loc, depts]) => depts.map((d) => `${loc.toLowerCase().trim()}||${d.toLowerCase().trim()}`))
);
const isAllowedOffice = (location: string, department: string): boolean =>
  ALLOWED_OFFICES.has(`${location.toLowerCase().trim()}||${department.toLowerCase().trim()}`);

// Full (city, department, board?) tuple identity — the SAME shape Okta sends.
const tupleId = (city: string, department: string, board: string | null): string =>
  [city, department, board ?? ""].join("||");

function classify(dir: DirectoryPerson[]): Classified {
  let skippedNoEmail = 0;
  let skippedNoTuple = 0;
  let skippedNotAllowed = 0;
  const usable: DirectoryPerson[] = [];
  for (const p of dir) {
    if (!p.email) { skippedNoEmail += 1; continue; }
    if (!p.location || !p.department) { skippedNoTuple += 1; continue; }
    if (!isAllowedOffice(p.location, p.department)) { skippedNotAllowed += 1; continue; }
    usable.push(p);
  }
  return { usable, skippedNoEmail, skippedNoTuple, skippedNotAllowed };
}

/** Read-only dry run. Never writes. */
export async function previewImport(fetchSource: DirectorySource): Promise<ImportPreview> {
  const dir = await fetchSource();
  if (dir === null) return { ok: false, error: "Could not reach the directory source — check the Okta API token / org URL." };

  const { usable, skippedNoEmail, skippedNoTuple, skippedNotAllowed } = classify(dir);

  // Group by the full (city, department, board?) tuple.
  const groups = new Map<string, { city: string; department: string; board: string | null; people: number }>();
  let withBoard = 0;
  for (const p of usable) {
    if (p.board) withBoard += 1;
    const id = tupleId(p.location!, p.department!, p.board);
    const g = groups.get(id) ?? { city: p.location!, department: p.department!, board: p.board, people: 0 };
    g.people += 1;
    groups.set(id, g);
  }

  const existingEmails = await emailBusinessUnitMap();
  let matchedUsers = 0;
  let newUsers = 0;
  const seenEmail = new Set<string>();
  for (const p of usable) {
    if (seenEmail.has(p.email)) continue; // a person is one user regardless of dup directory rows
    seenEmail.add(p.email);
    if (existingEmails.has(p.email)) matchedUsers += 1;
    else newUsers += 1;
  }

  const out: ImportGroup[] = [];
  let newInstances = 0;
  for (const g of groups.values()) {
    const existing = await findInstanceByTuple(g.city, g.department, g.board);
    if (!existing) newInstances += 1;
    out.push({ city: g.city, department: g.department, board: g.board, key: existing?.key ?? null, existing: !!existing, people: g.people });
  }
  out.sort((a, b) => b.people - a.people);

  return {
    ok: true,
    totalEmployees: dir.length,
    skippedNoEmail,
    skippedNoTuple,
    skippedNotAllowed,
    withTuple: usable.length,
    withBoard,
    groups: out,
    newInstances,
    existingInstances: out.length - newInstances,
    matchedUsers,
    newUsers,
  };
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  instancesCreated?: number;
  instancesTotal?: number;
  usersCreated?: number;
  usersReassigned?: number;
  skippedNoEmail?: number;
  skippedNoTuple?: number;
  skippedNotAllowed?: number;
}

/** Perform the import. Idempotent: existing instances/users are reused, and a
 *  person is only re-homed when their derived instance differs from now. */
export async function applyImport(actorId: string, fetchSource: DirectorySource): Promise<ImportResult> {
  const dir = await fetchSource();
  if (dir === null) return { ok: false, error: "Could not reach the directory source — check the Okta API token / org URL." };

  const { usable, skippedNoEmail, skippedNoTuple, skippedNotAllowed } = classify(dir);

  // 1. Resolve every office to an instance key, creating any that are new.
  //    Do this BEFORE touching people: the home-instance trigger references
  //    instance(key), so the instance must exist first.
  const tupleKeys = new Map<string, string>();
  let instancesCreated = 0;
  const uniqueTuples = new Map<string, { city: string; department: string; board: string | null }>();
  for (const p of usable) uniqueTuples.set(tupleId(p.location!, p.department!, p.board), { city: p.location!, department: p.department!, board: p.board });
  for (const [id, t] of uniqueTuples) {
    const existing = await findInstanceByTuple(t.city, t.department, t.board);
    if (!existing) instancesCreated += 1;
    tupleKeys.set(id, await deriveInstanceKey(t.city, t.department, t.board));
  }

  // 2. Partition people into "create" (unknown email) and "re-home" (known
  //    email whose current home differs from the derived key). Dedup by email.
  const existingPeople = await emailBusinessUnitMap();
  const toCreate = new Map<string, { email: string; name: string; businessUnit: string }>();
  const reassignByKey = new Map<string, string[]>();
  for (const p of usable) {
    const key = tupleKeys.get(tupleId(p.location!, p.department!, p.board))!;
    const known = existingPeople.get(p.email);
    if (!known) {
      if (!toCreate.has(p.email)) toCreate.set(p.email, { email: p.email, name: p.name || p.email, businessUnit: key });
    } else if (known.businessUnit !== key) {
      const ids = reassignByKey.get(key) ?? [];
      ids.push(known.id);
      reassignByKey.set(key, ids);
    }
  }

  const usersCreated = await bulkCreatePeopleWithBu([...toCreate.values()]);
  let usersReassigned = 0;
  for (const [key, ids] of reassignByKey) {
    await bulkSetBusinessUnit(ids, key);
    usersReassigned += ids.length;
  }

  await insertAuditLog({
    entityType: "instance_import",
    // audit_log.entity_id is a NOT NULL uuid; this is a registry-wide event with
    // no single entity, so use the nil UUID as a stable sentinel.
    entityId: "00000000-0000-0000-0000-000000000000",
    actorId,
    action: "okta_import",
    newValue: { instancesCreated, instancesTotal: uniqueTuples.size, usersCreated, usersReassigned, skippedNoEmail, skippedNoTuple, skippedNotAllowed },
  });

  return {
    ok: true,
    instancesCreated,
    instancesTotal: uniqueTuples.size,
    usersCreated,
    usersReassigned,
    skippedNoEmail,
    skippedNoTuple,
    skippedNotAllowed,
  };
}
