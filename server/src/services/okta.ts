import { config } from "../config";
import type { DirectoryPerson } from "./instanceImport";

/**
 * Okta Admin API client — read-only, used ONLY by the owner instance-seed
 * import. Okta is the source of truth for a person's isolated instance: the
 * same (city, department, whiteboard_number) profile attributes the OIDC login
 * already reads. Auth is the Okta "SSWS <token>" scheme. Every call is guarded
 * so an Okta hiccup yields null rather than throwing into a request.
 */

/** Resolve the Okta org base URL: explicit override, else the ORIGIN of the
 *  configured OIDC issuer (e.g. https://alphasights.okta.com/oauth2/default ->
 *  https://alphasights.okta.com). Null when neither is available. */
export function oktaOrgUrl(): string | null {
  if (config.oktaOrgUrl) return config.oktaOrgUrl.replace(/\/+$/, "");
  if (config.oidcIssuerUrl) {
    try {
      return new URL(config.oidcIssuerUrl).origin;
    } catch {
      return null;
    }
  }
  return null;
}

/** True when both an org URL and an API token are available. */
export function oktaConfigured(): boolean {
  return !!(oktaOrgUrl() && config.oktaApiToken);
}

interface OktaUser {
  status?: string;
  profile?: {
    email?: string | null;
    login?: string | null;
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    city?: string | null;
    department?: string | null;
    whiteboard_number?: string | null;
  };
}

const authHeader = () => ({ Authorization: `SSWS ${config.oktaApiToken}`, Accept: "application/json" });

function nextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // Okta paginates via RFC-5988 Link headers: <url>; rel="next"
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

const mapUser = (u: OktaUser): DirectoryPerson => {
  const p = u.profile ?? {};
  const email = (p.email ?? p.login ?? "").trim().toLowerCase();
  return {
    employeeId: email, // Okta directory has no BambooHR employeeId; email is the stable key
    email,
    name: (p.displayName?.trim() || [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || email).trim(),
    location: p.city?.trim() || null,
    department: p.department?.trim() || null,
    board: p.whiteboard_number?.trim() || null,
  };
};

/**
 * The full Okta directory (ACTIVE users) as DirectoryPerson rows, following
 * pagination to the end. Returns null on any failure or when not configured.
 */
export async function fetchOktaDirectory(): Promise<DirectoryPerson[] | null> {
  const org = oktaOrgUrl();
  if (!org || !config.oktaApiToken) return null;
  const out: DirectoryPerson[] = [];
  // Only current/active users; 200 per page (Okta's max).
  let url: string | null = `${org}/api/v1/users?limit=200&filter=${encodeURIComponent('status eq "ACTIVE"')}`;
  try {
    let guard = 0;
    while (url && guard < 200) {
      guard += 1;
      const res: Response = await fetch(url, { headers: authHeader() });
      if (!res.ok) return null;
      const page = (await res.json()) as OktaUser[];
      for (const u of page) {
        const person = mapUser(u);
        if (person.email) out.push(person);
      }
      url = nextLink(res.headers.get("link"));
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Owner diagnostics for the Okta directory: reachability, counts, and the
 * DISTINCT city / department / whiteboard_number values (with counts) actually
 * present — the "inspect fields" equivalent, but Okta's attribute names are
 * known, so this just confirms the values look right before an import.
 */
export async function diagnoseOktaDirectory(): Promise<{
  ok: boolean;
  error?: string;
  users?: number;
  withTuple?: number;
  withBoard?: number;
  values?: Record<string, { value: string; count: number }[]>;
}> {
  if (!oktaConfigured()) return { ok: false, error: "Okta API not configured — set OKTA_API_TOKEN (and OKTA_ORG_URL if the OIDC issuer isn't your Okta org)." };
  const dir = await fetchOktaDirectory();
  if (dir === null) return { ok: false, error: "Could not reach the Okta API — check the token and org URL (needs read-only Users API access)." };

  const tally = (pick: (p: DirectoryPerson) => string | null) => {
    const counts = new Map<string, number>();
    for (const p of dir) {
      const v = (pick(p) ?? "").trim() || "(empty)";
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  };

  return {
    ok: true,
    users: dir.length,
    withTuple: dir.filter((p) => p.location && p.department).length,
    withBoard: dir.filter((p) => p.board).length,
    values: { city: tally((p) => p.location), department: tally((p) => p.department), whiteboard_number: tally((p) => p.board) },
  };
}
