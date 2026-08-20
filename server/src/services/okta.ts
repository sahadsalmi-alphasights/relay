import { config } from "../config";
import { getHints, getSecret } from "./secretsVault";
import type { DirectoryPerson } from "./instanceImport";

/**
 * Okta Admin API client — read-only, used ONLY by the owner instance-seed
 * import. Okta is the source of truth for a person's isolated instance: the
 * same (city, department, whiteboard_number) profile attributes the OIDC login
 * already reads. Auth is the Okta "SSWS <token>" scheme. Every call is guarded
 * so an Okta hiccup yields null rather than throwing into a request.
 *
 * The API token can be pasted in Integrations (encrypted at rest via the vault)
 * OR provided via env (OKTA_API_TOKEN) — in-app takes precedence, exactly like
 * the Slack/BambooHR credentials. NOTE: this is a dedicated Okta API token, not
 * the OIDC login client secret — the Users API needs its own token / a service
 * app with the okta.users.read scope.
 */

/** Vault secret names for the Okta credentials. */
export const OKTA_SECRET = {
  apiToken: "okta.api_token",
  orgUrl: "okta.org_url",
} as const;

export interface OktaCredHint {
  hasValue: boolean;
  /** Shown value: last-4 for the token, the full URL for org URL. */
  hint: string | null;
  /** Where the active value comes from. "derived" = org URL taken from the OIDC issuer. */
  source: "in-app" | "env" | "derived" | null;
}

function resolveSecretOrEnv(name: string, envFallback: string): Promise<string> {
  return getSecret(name)
    .then((stored) => stored || envFallback)
    .catch(() => envFallback);
}

/** The Okta API token: vault (in-app) → env. */
export const getOktaApiToken = () => resolveSecretOrEnv(OKTA_SECRET.apiToken, config.oktaApiToken);

/** Derive an org base URL from the OIDC issuer origin (login provider), or null. */
function orgUrlFromIssuer(): string | null {
  if (!config.oidcIssuerUrl) return null;
  try {
    return new URL(config.oidcIssuerUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the Okta org base URL: vault (in-app) → env OKTA_ORG_URL → the ORIGIN
 * of the OIDC issuer (e.g. https://acme.okta.com/oauth2/default -> https://acme.okta.com).
 * Null when none is available. Trailing slashes trimmed.
 */
export async function getOktaOrgUrl(): Promise<string | null> {
  const stored = await getSecret(OKTA_SECRET.orgUrl).catch(() => null);
  const val = stored || config.oktaOrgUrl || orgUrlFromIssuer() || "";
  return val ? val.replace(/\/+$/, "") : null;
}

/** True when both an org URL and an API token are available (stored or env). */
export async function oktaConfigured(): Promise<boolean> {
  return !!((await getOktaOrgUrl()) && (await getOktaApiToken()));
}

const last4 = (s: string) => (s.length >= 4 ? s.slice(-4) : s);

/** Per-credential status for the Integrations panel, reflecting vault + env. */
export async function getOktaHints(): Promise<{ apiToken: OktaCredHint; orgUrl: OktaCredHint }> {
  const vault = await getHints([OKTA_SECRET.apiToken, OKTA_SECRET.orgUrl]);

  const tokenVault = vault[OKTA_SECRET.apiToken];
  const apiToken: OktaCredHint = tokenVault?.hasValue
    ? { hasValue: true, hint: tokenVault.hint, source: "in-app" }
    : config.oktaApiToken
      ? { hasValue: true, hint: last4(config.oktaApiToken), source: "env" }
      : { hasValue: false, hint: null, source: null };

  const orgVault = vault[OKTA_SECRET.orgUrl];
  const derived = orgUrlFromIssuer();
  const orgUrl: OktaCredHint = orgVault?.hasValue
    ? { hasValue: true, hint: orgVault.hint, source: "in-app" }
    : config.oktaOrgUrl
      ? { hasValue: true, hint: config.oktaOrgUrl, source: "env" }
      : derived
        ? { hasValue: true, hint: derived, source: "derived" }
        : { hasValue: false, hint: null, source: null };

  return { apiToken, orgUrl };
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

const authHeader = (token: string) => ({ Authorization: `SSWS ${token}`, Accept: "application/json" });

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
  const org = await getOktaOrgUrl();
  const token = await getOktaApiToken();
  if (!org || !token) return null;
  const out: DirectoryPerson[] = [];
  // Only current/active users; 200 per page (Okta's max).
  let url: string | null = `${org}/api/v1/users?limit=200&filter=${encodeURIComponent('status eq "ACTIVE"')}`;
  try {
    let guard = 0;
    while (url && guard < 200) {
      guard += 1;
      const res: Response = await fetch(url, { headers: authHeader(token) });
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
  if (!(await oktaConfigured())) return { ok: false, error: "Okta API not configured — paste an API token in Integrations (org URL defaults to your OIDC issuer)." };
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
