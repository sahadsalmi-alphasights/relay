import { Issuer, generators, type Client } from "openid-client";
import { config } from "../config";

/**
 * §7/§11 step 6 — real OIDC (Authorization Code + PKCE) against whatever IdP
 * IT provisions (Okta / Azure AD / Google Workspace / ...). Nothing here is
 * provider-specific: `Issuer.discover` reads the standard
 * `/.well-known/openid-configuration` document at OIDC_ISSUER_URL, so the
 * same code works against any spec-compliant provider.
 *
 * Discovery is a network call, so it's done lazily on first use and cached
 * rather than at import/boot time -- an unreachable IdP at that instant
 * shouldn't be able to crash-loop the whole server before it even binds a
 * port. A failed discovery is NOT cached, so the next login attempt retries.
 */
let clientPromise: Promise<Client> | null = null;

function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = Issuer.discover(config.oidcIssuerUrl).then(
      (issuer) =>
        new issuer.Client({
          client_id: config.oidcClientId,
          client_secret: config.oidcClientSecret,
          redirect_uris: [config.oidcRedirectUri],
          response_types: ["code"],
        })
    );
    clientPromise.catch(() => {
      clientPromise = null;
    });
  }
  return clientPromise;
}

export interface OidcTransaction {
  codeVerifier: string;
  state: string;
  nonce: string;
}

/** Builds the redirect URL for step 1 of Authorization Code + PKCE, plus the values that must round-trip (via a signed cookie) to verify the callback. */
export async function buildAuthorizationUrl(): Promise<{ url: string; transaction: OidcTransaction }> {
  const client = await getClient();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();
  const nonce = generators.nonce();

  const url = client.authorizationUrl({
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  return { url, transaction: { codeVerifier, state, nonce } };
}

export interface OidcIdentity {
  email: string;
  name: string;
}

/**
 * Step 2: exchange the authorization code for tokens and return the claims
 * we care about. `client.callback()` does the actual security-critical work
 * (verifies the state param, the nonce inside the ID token, the token
 * signature, expiry, and audience) -- none of that is reimplemented here.
 */
export async function exchangeCallback(
  callbackParams: Record<string, string>,
  transaction: OidcTransaction
): Promise<OidcIdentity> {
  const client = await getClient();
  const tokenSet = await client.callback(config.oidcRedirectUri, callbackParams, {
    code_verifier: transaction.codeVerifier,
    state: transaction.state,
    nonce: transaction.nonce,
  });
  const claims = tokenSet.claims();
  if (!claims.email) {
    throw new Error("OIDC provider did not return an email claim");
  }
  return { email: claims.email, name: (claims.name as string | undefined) ?? claims.email };
}
