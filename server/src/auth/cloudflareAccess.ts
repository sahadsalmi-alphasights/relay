import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config";

export interface CfAccessOptions {
  /** e.g. "myteam.cloudflareaccess.com". Defaults to config.cfAccessTeamDomain. */
  teamDomain?: string;
  /** The Access application's Application Audience (AUD) tag. Defaults to config.cfAccessAud. */
  aud?: string;
}

// Health probes (deploy/monitoring) and CORS preflight must stay reachable
// without an Access assertion — everything else requires one when enabled.
const EXEMPT_PATHS = new Set(["/", "/health"]);

/**
 * Cloudflare Access origin validation (SECURITY_CONFIGURATION §21, item 1.7).
 *
 * Defense in depth: the cloudflared tunnel already makes the origin
 * unreachable directly, so this is a deliberately OPT-IN extra layer — with
 * either env var unset the plugin is completely inert (no hook, no behavior
 * change), so shipping it affects nobody until it's configured on purpose.
 *
 * When enabled it verifies the `Cf-Access-Jwt-Assertion` header (a JWT signed
 * by Cloudflare at the edge) against the team's JWKS and the application's AUD
 * on every request, rejecting anything that didn't come through Access.
 */
export default fp(async function cloudflareAccessPlugin(app: FastifyInstance, opts: CfAccessOptions) {
  const teamDomain = (opts.teamDomain ?? config.cfAccessTeamDomain).trim();
  const aud = (opts.aud ?? config.cfAccessAud).trim();

  if (!teamDomain || !aud) {
    app.log.info("Cloudflare Access origin validation: disabled (CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD not set)");
    return;
  }

  const issuer = `https://${teamDomain}`;
  // Cloudflare rotates these keys; createRemoteJWKSet fetches and caches them,
  // refetching on an unknown key id — no manual key management.
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  app.log.info({ issuer, aud }, "Cloudflare Access origin validation: ENABLED");

  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") return;
    const path = request.url.split("?")[0];
    if (EXEMPT_PATHS.has(path)) return;

    const token = request.headers["cf-access-jwt-assertion"];
    if (!token || typeof token !== "string") {
      reply.code(403).send({ error: "cloudflare access required" });
      return reply;
    }
    try {
      await jwtVerify(token, jwks, { issuer, audience: aud });
    } catch (err) {
      request.log.warn({ err }, "rejected request with invalid Cloudflare Access assertion");
      reply.code(403).send({ error: "invalid cloudflare access token" });
      return reply;
    }
  });
});
