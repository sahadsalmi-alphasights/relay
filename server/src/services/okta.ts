import { createHash, createPublicKey, createSign, randomUUID } from "crypto";
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

const b64urlJSON = (o: object): string => Buffer.from(JSON.stringify(o)).toString("base64url");
const signRS256 = (input: string, keyPem: string): string =>
  createSign("RSA-SHA256").update(input).end().sign(keyPem).toString("base64url");
/** HTTP URI for a DPoP `htu` claim — scheme+host+path, no query/fragment. */
const httpUri = (u: string): string => {
  const url = new URL(u);
  return `${url.origin}${url.pathname}`;
};

/**
 * A DPoP proof JWT (RFC 9449). Header carries the PUBLIC JWK (kty/n/e — no
 * secret) and typ dpop+jwt; claims bind the proof to this HTTP method + URI
 * with a unique jti. `nonce` is added when the server challenges with one;
 * `accessToken` adds the `ath` hash that binds the proof to the token on
 * resource requests.
 */
export function buildDpopProof(
  htu: string,
  htm: string,
  keyPem: string,
  nowSec: number,
  opts?: { nonce?: string; accessToken?: string }
): string {
  const jwk = createPublicKey({ key: keyPem }).export({ format: "jwk" }) as { kty: string; n: string; e: string };
  const header = b64urlJSON({ typ: "dpop+jwt", alg: "RS256", jwk: { kty: jwk.kty, n: jwk.n, e: jwk.e } });
  const claims: Record<string, unknown> = { htu: httpUri(htu), htm, iat: nowSec, jti: randomUUID() };
  if (opts?.nonce) claims.nonce = opts.nonce;
  if (opts?.accessToken) claims.ath = createHash("sha256").update(opts.accessToken).digest("base64url");
  const payload = b64urlJSON(claims);
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${signRS256(signingInput, keyPem)}`;
}

/**
 * Mint an OAuth access token via private_key_jwt WITH DPoP. Sends a DPoP proof
 * on the token request and, on Okta's `use_dpop_nonce` challenge, retries once
 * with the returned nonce. Keeps the failure reason for diagnostics; caches the
 * (DPoP-bound) token in memory. Result carries ok + token or a readable error.
 */
async function mintOAuthToken(org: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  const clientId = await getOktaClientId();
  const privateKey = await getOktaPrivateKey();
  if (!clientId || !privateKey) return { ok: false, error: "no OAuth client id / private key" };

  const tokenUrl = `${org}/oauth2/v1/token`;
  let assertion: string;
  try {
    assertion = buildClientAssertion(tokenUrl, clientId, privateKey, Math.floor(Date.now() / 1000));
  } catch (e) {
    return { ok: false, error: `couldn't sign client assertion — private key not valid PEM (${e instanceof Error ? e.message : "?"})` };
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: OKTA_SCOPE,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  });
  const post = (nonce?: string) =>
    fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        DPoP: buildDpopProof(tokenUrl, "POST", privateKey, Math.floor(Date.now() / 1000), { nonce }),
      },
      body,
    });
  try {
    let res = await post();
    let json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok && json.error === "use_dpop_nonce") {
      res = await post(res.headers.get("dpop-nonce") ?? undefined);
      json = (await res.json().catch(() => ({}))) as typeof json;
    }
    if (!res.ok || !json.access_token) {
      const detail = json.error ? `${json.error}${json.error_description ? ` — ${json.error_description}` : ""}` : `HTTP ${res.status}`;
      return { ok: false, error: `token endpoint at ${tokenUrl}: ${detail}` };
    }
    tokenCache = { token: json.access_token, expiresAt: Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600) };
    return { ok: true, token: json.access_token };
  } catch (e) {
    return { ok: false, error: `network error reaching ${tokenUrl}: ${e instanceof Error ? e.message : "?"}` };
  }
}

/** Cached (DPoP-bound) OAuth token, minting a fresh one when near expiry. */
async function cachedOAuthToken(org: string): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt - 60 > now) return tokenCache.token;
  const r = await mintOAuthToken(org);
  return r.ok ? r.token! : null;
}

// Okta hands out a rolling DPoP nonce on resource requests; remember the latest
// so the next request presents it up front (avoids an extra challenge round).
let resourceNonce: string | undefined;

/**
 * GET an Okta API URL with whichever auth mode is configured. OAuth mode sends
 * a per-request DPoP proof (with `ath`) and `Authorization: DPoP <token>`,
 * retrying once on a `use_dpop_nonce` 401. SSWS mode sends the static token.
 * Returns the Response, or an { error } when auth can't even be attempted.
 */
async function oktaApiGet(org: string, url: string): Promise<{ res: Response } | { error: string }> {
  if (await oauthConfigured()) {
    const token = await cachedOAuthToken(org);
    if (!token) return { error: "OAuth token exchange failed (run Test for detail)" };
    const privateKey = await getOktaPrivateKey();
    const get = (nonce?: string) =>
      fetch(url, {
        headers: {
          Authorization: `DPoP ${token}`,
          Accept: "application/json",
          DPoP: buildDpopProof(url, "GET", privateKey, Math.floor(Date.now() / 1000), { accessToken: token, nonce }),
        },
      });
    let res = await get(resourceNonce);
    if (res.status === 401) {
      const nonce = res.headers.get("dpop-nonce");
      if (nonce) {
        resourceNonce = nonce;
        res = await get(nonce);
      }
    }
    const rolled = res.headers.get("dpop-nonce");
    if (rolled) resourceNonce = rolled;
    return { res };
  }
  const token = await getOktaApiToken();
  if (!token) return { error: "no SSWS token" };
  return { res: await fetch(url, { headers: { Authorization: `SSWS ${token}`, Accept: "application/json" } }) };
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
  const out: DirectoryPerson[] = [];
  // Only current/active users; 200 per page (Okta's max).
  let url: string | null = `${org}/api/v1/users?limit=200&filter=${encodeURIComponent('status eq "ACTIVE"')}`;
  try {
    let guard = 0;
    while (url && guard < 200) {
      guard += 1;
      const r = await oktaApiGet(org, url);
      if ("error" in r) return null;
      const res = r.res;
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
 * present. Surfaces the real failure (token exchange vs Users API) instead of
 * a generic "could not reach", including DPoP-required and scope/role errors.
 */
export async function diagnoseOktaDirectory(): Promise<{
  ok: boolean;
  error?: string;
  authMode?: "oauth" | "token";
  users?: number;
  withTuple?: number;
  withBoard?: number;
  values?: Record<string, { value: string; count: number }[]>;
}> {
  const org = await getOktaOrgUrl();
  if (!org) return { ok: false, error: "No Okta org URL — set OIDC issuer or an explicit Org base URL." };

  let authMode: "oauth" | "token";
  if (await oauthConfigured()) {
    authMode = "oauth";
    // Mint with the reason kept (DPoP nonce handled inside). This warms the cache.
    const minted = await mintOAuthToken(org);
    if (!minted.ok) return { ok: false, authMode, error: `OAuth token exchange failed — ${minted.error}. Check: client auth = Public key/Private key, the JWK is registered, and scope okta.users.read is granted.` };
  } else if (await getOktaApiToken()) {
    authMode = "token";
  } else {
    return { ok: false, error: "Okta API not configured — add OAuth (client id + private key) or an SSWS token." };
  }

  // Probe the Users API (OAuth path sends the DPoP proof) with the reason kept.
  const probe = await oktaApiGet(org, `${org}/api/v1/users?limit=1`);
  if ("error" in probe) return { ok: false, authMode, error: probe.error };
  if (!probe.res.ok) {
    const body = (await probe.res.json().catch(() => ({}))) as { errorCode?: string; errorSummary?: string };
    const detail = body.errorSummary || body.errorCode || `HTTP ${probe.res.status}`;
    const hint = probe.res.status === 403 ? " (grant the app the Read-Only Administrator role + okta.users.read scope)" : "";
    return { ok: false, authMode, error: `Users API returned ${probe.res.status}: ${detail}${hint}` };
  }

  const dir = await fetchOktaDirectory();
  if (dir === null) return { ok: false, authMode, error: "Reached Okta, but the directory read returned nothing usable." };

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
    authMode,
    users: dir.length,
    withTuple: dir.filter((p) => p.location && p.department).length,
    withBoard: dir.filter((p) => p.board).length,
    values: { city: tally((p) => p.location), department: tally((p) => p.department), whiteboard_number: tally((p) => p.board) },
  };
}
