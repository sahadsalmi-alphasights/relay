import type { BusinessUnit } from "../db";

/**
 * Map the Okta `department` claim to a CapTracker business unit.
 *
 * The identity provider (Okta) is the source of truth for which BU a person
 * belongs to. Two department values matter; anything else — including a
 * missing or misspelt department — returns null, meaning "don't know": the
 * caller then LEAVES the person's current BU untouched rather than guessing
 * (so a briefly-misconfigured claim can never silently move someone between
 * isolated environments). Matching is case-insensitive and whitespace-tolerant.
 */
const DEPARTMENT_TO_BU: Record<string, BusinessUnit> = {
  "dub - consulting": "consulting",
  "dub - non-consulting": "non_consulting",
};

export function mapDepartmentToBu(department: string | null | undefined): BusinessUnit | null {
  if (!department) return null;
  const key = department.trim().toLowerCase().replace(/\s+/g, " ");
  return DEPARTMENT_TO_BU[key] ?? null;
}
