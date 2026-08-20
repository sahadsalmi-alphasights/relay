import { createSign, randomUUID } from "crypto";
import { config } from "../config";
import { getHints, getSecret } from "./secretsVault";
import type { DirectoryPerson } from "./instanceImport";

/**
 * Okta Admin API client — read-only, used ONLY by the owner instance-seed
 * import. Okta is the source of truth for a person's isolated instance: the
 * same (city, department, whiteboard_number) profile attributes the OIDC login
 * already reads. Every call is guarded so an Okta hiccup yields null rather
 * than throwing into a request.
 *
 * Two auth modes, in preference order:
 *  1. OAuth 2.0 client-credentials (private_key_jwt) — an Okta "API Services"
 *     app granted ONLY okta.users.read. We sign a short-lived JWT assertion
 *     with the app's private key, exchange it at the org token endpoint for a
 *     short-lived bearer access token, and cache that until it nears expiry.
 *     This is the scoped, future-proof path (SSWS tokens are being deprecated).
 *  2. SSWS API token — the legacy static token (read-only admin). Fallback.
 *
 * All credentials can be pasted in Integrations (encrypted at rest via the
 * vault) OR provided via env — in-app takes precedence, like Slack/BambooHR.
 */

/** Vault secret names for the Okta credentials. */
export const OKTA_SECRET = {
  apiToken: "okta.api_token",
  orgUrl: "okta.org_url",
  clientId: "okta.client_id",
  privateKey: "okta.private_key",
} as const;

/** The OAuth scope this integration requests — read users only. */
export const OKTA_SCOPE = "okta.users.read";

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

/** The Okta API token (SSWS): vault (in-app) → env. */
export const getOktaApiToken = () => resolveSecretOrEnv(OKTA_SECRET.apiToken, config.oktaApiToken);
/** OAuth client id (not secret): vault → env. */
export const getOktaClientId = () => resolveSecretOrEnv(OKTA_SECRET.clientId, config.oktaClientId);
/** OAuth private key (PEM): vault → env. */
export const getOktaPrivateKey = () => resolveSecretOrEnv(OKTA_SECRET.privateKey, config.oktaPrivateKey);

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

/** True when OAuth (client id + private key) credentials are available. */
async function oauthConfigured(): Promise<boolean> {
  return !!((await getOktaClientId()) && (await getOktaPrivateKey()));
}

/** True when the directory can be reached: an org URL AND either auth mode. */
export async function oktaConfigured(): Promise<boolean> {
  if (!(await getOktaOrgUrl())) return false;
  return (await oauthConfigured()) || !!(await getOktaApiToken());
}

/**
 * Build a signed client_assertion JWT (private_key_jwt) for the Okta org token
 * endpoint. Header alg RS256; claims iss=sub=clientId, aud=token endpoint,
 * short lifetime, unique jti. Signed with the app's PEM private key.
 */
export function buildClientAssertion(tokenUrl: string, clientId: string, privateKeyPem: string, nowSec: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const payload = b64({ iss: clientId, sub: clientId, aud: tokenUrl, iat: nowSec, exp: nowSec + 300, jti: randomUUID() });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).end().sign(privateKeyPem).toString("base64url");
  return `${signingInput}.${signature}`;
}

// Cache the OAuth access token in memory until shortly before it expires, so we
// don't mint one per request. Cleared implicitly on process restart.
let tokenCache: { token: string; expiresAt: number } | null = null;

/** Mint (or reuse a cached) OAuth bearer access token. Null on failure/misconfig. */
async function getOktaAccessToken(org: string): Promise<string | null> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt - 60 > nowSec) return tokenCache.token;

  const clientId = await getOktaClientId();
  const privateKey = await getOktaPrivateKey();
  if (!clientId || !privateKey) return null;

  const tokenUrl = `${org}/oauth2/v1/token`;
  let assertion: string;
  try {
    assertion = buildClientAssertion(tokenUrl, clientId, privateKey, nowSec);
  } catch {
    return null; // bad/unparseable private key
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: OKTA_SCOPE,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  });
  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    tokenCache = { token: json.access_token, expiresAt: nowSec + (json.expires_in ?? 3600) };
    return json.access_token;
  } catch {
    return null;
  }
}

/**
 * Resolve the Authorization header for a directory call: OAuth bearer when a
 * client id + private key are configured, else the SSWS token, else null.
 */
async function oktaAuthHeader(org: string): Promise<{ Authorization: string } | null> {
  if (await oauthConfigured()) {
    const access = await getOktaAccessToken(org);
    return access ? { Authorization: `Bearer ${access}` } : null;
  }
  const token = await getOktaApiToken();
  return token ? { Authorization: `SSWS ${token}` } : null;
}

const last4 = (s: string) => (s.length >= 4 ? s.slice(-4) : s);

/** Per-credential status for the Integrations panel, reflecting vault + env,
 *  plus which auth mode is active (oauth / token / none). */
export async function getOktaHints(): Promise<{
  apiToken: OktaCredHint;
  clientId: OktaCredHint;
  privateKey: OktaCredHint;
  orgUrl: OktaCredHint;
  authMode: "oauth" | "token" | "none";
}> {
  const vault = await getHints([OKTA_SECRET.apiToken, OKTA_SECRET.clientId, OKTA_SECRET.privateKey, OKTA_SECRET.orgUrl]);

  const secretHint = (name: string, env: string): OktaCredHint => {
    const v = vault[name];
    if (v?.hasValue) return { hasValue: true, hint: v.hint, source: "in-app" };
    if (env) return { hasValue: true, hint: last4(env), source: "env" };
    return { hasValue: false, hint: null, source: null };
  };

  const apiToken = secretHint(OKTA_SECRET.apiToken, config.oktaApiToken);
  const clientId = secretHint(OKTA_SECRET.clientId, config.oktaClientId);
  const privateKey = secretHint(OKTA_SECRET.privateKey, config.oktaPrivateKey);

  const orgVault = vault[OKTA_SECRET.orgUrl];
  const derived = orgUrlFromIssuer();
  const orgUrl: OktaCredHint = orgVault?.hasValue
    ? { hasValue: true, hint: orgVault.hint, source: "in-app" }
    : config.oktaOrgUrl
      ? { hasValue: true, hint: config.oktaOrgUrl, source: "env" }
      : derived
        ? { hasValue: true, hint: derived, source: "derived" }
        : { hasValue: false, hint: null, source: null };

  const authMode = clientId.hasValue && privateKey.hasValue ? "oauth" : apiToken.hasValue ? "token" : "none";

  return { apiToken, clientId, privateKey, orgUrl, authMode };
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
  if (!org) return null;
  const auth = await oktaAuthHeader(org);
  if (!auth) return null;
  const out: DirectoryPerson[] = [];
  // Only current/active users; 200 per page (Okta's max).
  let url: string | null = `${org}/api/v1/users?limit=200&filter=${encodeURIComponent('status eq "ACTIVE"')}`;
  try {
    let guard = 0;
    while (url && guard < 200) {
      guard += 1;
      const res: Response = await fetch(url, { headers: { ...auth, Accept: "application/json" } });
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
  if (!(await oktaConfigured())) return { ok: false, error: "Okta API not configured — add OAuth (client id + private key) or an SSWS API token in Integrations (org URL defaults to your OIDC issuer)." };
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
