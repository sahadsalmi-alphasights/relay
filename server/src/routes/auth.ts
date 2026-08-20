import type { FastifyPluginAsync } from "fastify";
import { buildAuthorizationUrl, exchangeCallback, type OidcTransaction } from "../auth/oidc";
import { issueSession, SESSION_COOKIE } from "../auth/plugin";
import { config } from "../config";
import { badRequest, forbidden, notFound, unauthorized } from "../errors";
import {
  bumpSessionVersion,
  findOrCreatePersonByEmail,
  findPersonById,
  listPeople,
  markLogin,
  setDeactivated,
  setOwner,
  setPersonBusinessUnit,
  type PersonRow,
} from "../repositories/people";
import { deriveInstanceKey } from "../repositories/instances";
import { isAllowedOffice } from "../services/instanceImport";

const OIDC_TXN_COOKIE = "relay_oidc_txn";

// A fresh login starts a new absolute window; the embedded session_version is
// what a later bump (logout-everywhere / deactivation) checks against.
function setSessionCookie(reply: import("fastify").FastifyReply, person: PersonRow) {
  issueSession(reply, person.id, person.sessionVersion);
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

    setSessionCookie(reply, person);
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
      const isOwnerEmail = config.ownerEmails.includes(identity.email.toLowerCase());
      let person = await findOrCreatePersonByEmail(identity.email, identity.name);

      // Instance assignment from Okta: the (city, department) resolves to an
      // isolated instance (auto-created for a new office, or the matching
      // existing one) and becomes the person's home. Gated by the approved
      // office allowlist so a sign-in never creates an off-list instance;
      // whiteboard/board is intentionally ignored for now (department-level
      // only). A missing/off-list office leaves the person's current instance
      // untouched.
      if (identity.city && identity.department && isAllowedOffice(identity.city, identity.department)) {
        const key = await deriveInstanceKey(identity.city, identity.department, null);
        if (key !== person.businessUnit) {
          await setPersonBusinessUnit(person.id, key); // trigger adds the membership
          person = { ...person, businessUnit: key };
        }
      }

      // Owner allowlist wins over everything: the founders can never be
      // locked out, so an allowlisted email is (re)granted Owner and
      // reactivated on login regardless of prior portal changes.
      if (isOwnerEmail) {
        if (person.deactivatedAt) person = await setDeactivated(person.id, false);
        if (!person.isOwner) person = await setOwner(person.id, true);
      } else if (person.deactivatedAt) {
        // Everyone else: a deactivated account may not sign in.
        request.log.warn({ email: identity.email }, "sign-in blocked: account deactivated");
        reply.redirect(`${config.webOrigin}/?ssoError=disabled`);
        return;
      }

      await markLogin(person.id);
      setSessionCookie(reply, person);
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

  // Logout everywhere — bump the caller's session_version so EVERY device's
  // cookie (this one included) is rejected on its next request, then clear the
  // local cookie for an immediate effect here. This is the revocation the
  // plain /logout can't give (that only drops the current browser's cookie).
  app.post("/logout-all", async (request, reply) => {
    if (!request.actor) throw unauthorized();
    await bumpSessionVersion(request.actor.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/me", async (request) => request.actor ?? null);
};

export default authRoutes;
