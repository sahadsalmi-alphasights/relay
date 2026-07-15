import type { FastifyPluginAsync } from "fastify";
import { buildAuthorizationUrl, exchangeCallback, type OidcTransaction } from "../auth/oidc";
import { SESSION_COOKIE } from "../auth/plugin";
import { config } from "../config";
import { badRequest, forbidden, notFound } from "../errors";
import { findOrCreatePersonByEmail, findPersonById, listPeople } from "../repositories/people";

const OIDC_TXN_COOKIE = "relay_oidc_txn";

function setSessionCookie(reply: import("fastify").FastifyReply, personId: string) {
  reply.setCookie(SESSION_COOKIE, personId, {
    signed: true,
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

const authRoutes: FastifyPluginAsync = async (app) => {
  // Public (no auth required) — lets the web app decide which login UI to
  // render without hardcoding build-time knowledge of the server's mode.
  app.get("/mode", async () => ({ devAuth: config.devAuth }));

  // DEV_AUTH only (spec §7) — lists seeded people so a dev/demo picker (step 4 UI) can log in as one.
  app.get("/dev-users", async () => {
    if (!config.devAuth) throw forbidden("DEV_AUTH is disabled");
    const people = await listPeople();
    return people.map((p) => ({ id: p.id, name: p.name, email: p.email }));
  });

  app.post<{ Body: { personId?: string } }>("/dev-login", async (request, reply) => {
    if (!config.devAuth) throw forbidden("DEV_AUTH is disabled");
    const { personId } = request.body ?? {};
    if (!personId) throw badRequest("personId is required");
    const person = await findPersonById(personId);
    if (!person) throw notFound("unknown person");

    setSessionCookie(reply, person.id);
    return person;
  });

  // §7/§11 step 6 — real OIDC (Authorization Code + PKCE), the production
  // auth path. Disabled while DEV_AUTH is active so the two never overlap.
  app.get("/oidc/login", async (request, reply) => {
    if (config.devAuth) throw forbidden("OIDC is disabled while DEV_AUTH is active");
    const { url, transaction } = await buildAuthorizationUrl();
    // Short-lived, signed, httpOnly — carries the PKCE verifier/state/nonce
    // across the redirect to the IdP and back. Nothing else needs it, and it
    // can't be read or forged by the browser.
    reply.setCookie(OIDC_TXN_COOKIE, JSON.stringify(transaction), {
      signed: true,
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    reply.redirect(url);
  });

  app.get<{ Querystring: Record<string, string> }>("/oidc/callback", async (request, reply) => {
    if (config.devAuth) throw forbidden("OIDC is disabled while DEV_AUTH is active");

    const raw = request.cookies[OIDC_TXN_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    reply.clearCookie(OIDC_TXN_COOKIE, { path: "/" });
    if (!unsigned?.valid || !unsigned.value) {
      request.log.warn("OIDC callback with missing or expired transaction cookie");
      reply.redirect(`${config.webOrigin}/?ssoError=1`);
      return;
    }

    try {
      const transaction: OidcTransaction = JSON.parse(unsigned.value);
      const identity = await exchangeCallback(request.query, transaction);
      const person = await findOrCreatePersonByEmail(identity.email, identity.name);
      setSessionCookie(reply, person.id);
      reply.redirect(config.webOrigin);
    } catch (err) {
      request.log.error(err, "OIDC callback failed");
      reply.redirect(`${config.webOrigin}/?ssoError=1`);
    }
  });

  app.post("/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/me", async (request) => request.actor ?? null);
};

export default authRoutes;
