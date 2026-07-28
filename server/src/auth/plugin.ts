import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config";
import { findPersonById, type PersonRow } from "../repositories/people";

export const SESSION_COOKIE = "relay_session";

/**
 * Sessions expire server-side, not just in the browser, and carry three
 * defences in one signed payload — `<personId>.<version>.<absExpiresAt>.<idleExpiresAt>`
 * (UUIDs contain no ".", and every field after it is an integer, so split is
 * unambiguous):
 *   - **absolute cap** (`ABSOLUTE_TTL_MS`): a session dies this long after
 *     login no matter how active — a stolen cookie can't live forever.
 *   - **idle timeout** (`IDLE_TTL_MS`): a sliding inactivity window,
 *     re-issued on activity (throttled) up to the absolute cap.
 *   - **revocation** (`version`): checked against person.session_version on
 *     every request; bumping the column kills all outstanding cookies at once.
 * Old-format cookies (fewer fields) are rejected — one forced re-login when
 * this ships, same as the previous format change.
 */
export const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const IDLE_TTL_MS = 12 * 60 * 60 * 1000;
// Don't re-sign the cookie on every request — only once the idle window has
// been consumed by more than this, so a busy session isn't re-issued constantly.
const REISSUE_THROTTLE_MS = 5 * 60 * 1000;

export function encodeSession(
  personId: string,
  version: number,
  nowMs = Date.now(),
  absExpiresAt = nowMs + ABSOLUTE_TTL_MS
): string {
  const idleExpiresAt = Math.min(nowMs + IDLE_TTL_MS, absExpiresAt);
  return `${personId}.${version}.${absExpiresAt}.${idleExpiresAt}`;
}

export interface DecodedSession {
  personId: string;
  version: number;
  absExpiresAt: number;
  idleExpiresAt: number;
}

export function decodeSession(value: string, nowMs = Date.now()): DecodedSession | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [personId, versionStr, absStr, idleStr] = parts;
  const version = Number(versionStr);
  const absExpiresAt = Number(absStr);
  const idleExpiresAt = Number(idleStr);
  if (!personId) return null;
  if (![version, absExpiresAt, idleExpiresAt].every((n) => Number.isFinite(n))) return null;
  // Either bound expiring ends the session: the absolute cap OR inactivity.
  if (absExpiresAt <= nowMs || idleExpiresAt <= nowMs) return null;
  return { personId, version, absExpiresAt, idleExpiresAt };
}

/**
 * Issue (or re-issue) the session cookie. `absExpiresAt` is fixed at first
 * login and preserved across re-issues, so sliding the idle window never
 * extends the absolute cap. Shared by the login routes and the sliding
 * re-issue in the auth hook.
 */
export function issueSession(
  reply: FastifyReply,
  personId: string,
  version: number,
  absExpiresAt?: number,
  nowMs = Date.now()
): void {
  const abs = absExpiresAt ?? nowMs + ABSOLUTE_TTL_MS;
  reply.setCookie(SESSION_COOKIE, encodeSession(personId, version, nowMs, abs), {
    signed: true,
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    // Advisory only (server enforces both bounds); tracks the absolute cap.
    maxAge: Math.max(1, Math.floor((abs - nowMs) / 1000)),
  });
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

  app.addHook("onRequest", async (request, reply) => {
    request.actor = null;
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const decoded = decodeSession(unsigned.value);
    if (!decoded) return;
    const person = await findPersonById(decoded.personId);
    if (!person) return;
    // Server-side revocation: the cookie's embedded version must equal the
    // person's current session_version. A bump (logout-everywhere,
    // deactivation, compromise) makes every outstanding cookie fail here.
    if (person.sessionVersion !== decoded.version) return;
    request.actor = person;
    // Sliding idle timeout: activity keeps the session alive up to the fixed
    // absolute cap. Throttled so we don't re-sign a cookie on every request.
    const nowMs = Date.now();
    const lastIssuedMs = decoded.idleExpiresAt - IDLE_TTL_MS;
    if (nowMs - lastIssuedMs >= REISSUE_THROTTLE_MS) {
      issueSession(reply, person.id, person.sessionVersion, decoded.absExpiresAt, nowMs);
    }
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
