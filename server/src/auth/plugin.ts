import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config";
import { findPersonById, type PersonRow } from "../repositories/people";

export const SESSION_COOKIE = "relay_session";

declare module "fastify" {
  interface FastifyRequest {
    actor: PersonRow | null;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
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
    request.actor = await findPersonById(unsigned.value);
  });

  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.actor) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });
});
