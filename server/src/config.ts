export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  databaseUrl: process.env.DATABASE_URL ?? "",
  nodeEnv: process.env.NODE_ENV ?? "development",
  devAuth: process.env.DEV_AUTH === "true",
  sessionSecret: process.env.SESSION_SECRET ?? "",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:dev@example.test",
  // §7/§11 step 6 — real OIDC/SSO. Issuer, client id/secret, and redirect URI
  // all come from env vars so no provider (Okta/Azure AD/Google Workspace/...)
  // is ever hardcoded.
  oidcIssuerUrl: process.env.OIDC_ISSUER_URL ?? "",
  oidcClientId: process.env.OIDC_CLIENT_ID ?? "",
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI ?? "",
  // User management — the OWNER allowlist. These emails are always granted
  // Owner on login and can never be locked out (see routes/auth.ts). Kept in
  // env, not source, so real addresses aren't committed to the repo. Comma
  // separated, case-insensitive.
  ownerEmails: (process.env.OWNER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
};

// Spec §7: DEV_AUTH must be impossible to enable in production. Refuse to boot
// rather than just warn, since a doc comment alone can't be trusted.
if (config.devAuth && config.nodeEnv === "production") {
  throw new Error(
    "DEV_AUTH=true is not allowed when NODE_ENV=production. Refusing to start."
  );
}

// §7/§11 step 6 — once DEV_AUTH is off, OIDC is the ONLY way anyone can log
// in. A missing var here would silently lock every one of the ~50 users out
// instead of failing loudly and immediately at boot, so check eagerly rather
// than waiting for the first login attempt to discover it.
if (!config.devAuth) {
  const required: Array<[string, string]> = [
    ["OIDC_ISSUER_URL", config.oidcIssuerUrl],
    ["OIDC_CLIENT_ID", config.oidcClientId],
    ["OIDC_CLIENT_SECRET", config.oidcClientSecret],
    ["OIDC_REDIRECT_URI", config.oidcRedirectUri],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} must be set when DEV_AUTH is not enabled. Refusing to start.`
    );
  }
}

// Session cookies are signed with this secret; an empty value produces a
// broken signer at request time instead of a clear error, so check at boot.
if (!config.sessionSecret) {
  throw new Error("SESSION_SECRET must be set. Refusing to start.");
}
