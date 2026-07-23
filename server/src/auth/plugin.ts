import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config";
import { findPersonById, type PersonRow } from "../repositories/people";

export const SESSION_COOKIE = "relay_session";

/**
 * Sessions expire server-side, not just in the browser: the cookie's maxAge
 * is advisory (a stolen cookie value ignores it), so the expiry is embedded
 * in the signed payload itself — `<personId>.<expiresAtMs>` — and checked on
 * every request. UUIDs contain no ".", so the delimiter is unambiguous.
 * Old-format cookies (bare person id, no expiry) are rejected, which simply
 * forces one re-login when this ships.
 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function encodeSession(personId: string, nowMs = Date.now()): string {
  return `${personId}.${nowMs + SESSION_TTL_MS}`;
}

export function decodeSession(value: string, nowMs = Date.now()): string | null {
  const dot = value.indexOf(".");
  if (dot === -1) return null;
  const personId = value.slice(0, dot);
  const expiresAt = Number(value.slice(dot + 1));
  if (!personId || !Number.isFinite(expiresAt) || expiresAt <= nowMs) return null;
  return personId;
}

declare module "fastify" {
  interface FastifyRequest {
    actor: PersonRow | null;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireOwner: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * DEV_AUTH session only (spec §7). Real OIDC (Authorization Code + PKCE) is
 * build-order step 6 — this plugin just needs *some* way to know who's
 * asking so §5e/§7b authorization can be enforced now. The cookie carries
 * only a person id, signed by @fastify/cookie so it can't be forged from the
 * client; nothing else is trusted from the request.
 */
export default fp(async function authPlugin(app: FastifyInstance) {
  await app.register(cookie, { secret: config.sessionSecret, hook: "onRequest" });

  app.decorateRequest("actor", null);

  app.addHook("onRequest", async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) {
      request.actor = null;
      return;
    }
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) {
      request.actor = null;
      return;
    }
    const personId = decodeSession(unsigned.value);
    if (!personId) {
      request.actor = null;
      return;
    }
    request.actor = await findPersonById(personId);
  });

  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.actor) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    // Deactivated accounts keep their history but can no longer act.
    if (request.actor.deactivatedAt) {
      reply.code(403).send({ error: "account deactivated" });
    }
  });

  // User management — owner-only routes (the admin portal). Enforced
  // server-side; hiding the nav item in the UI is not authorization.
  app.decorate("requireOwner", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.actor) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    if (request.actor.deactivatedAt || !request.actor.isOwner) {
      reply.code(403).send({ error: "owner only" });
    }
  });
});
