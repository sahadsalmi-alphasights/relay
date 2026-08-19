import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config";

const COOKIE = "relay_active_instance";

/**
 * The owner "view as" switcher. An owner can point their view at any instance;
 * everyone else is locked to their home instance (business_unit). This is the
 * read-scope the capacity ranking / matching use, so switching actually
 * changes the numbers — without letting a non-owner peek into another BU.
 *
 * Stored in a signed, http-only cookie so it survives navigation and can't be
 * forged client-side. Falls back to the actor's home instance when unset,
 * non-owner, or empty.
 */
export function setActiveInstanceCookie(reply: FastifyReply, key: string): void {
  reply.setCookie(COOKIE, key, {
    signed: true,
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function clearActiveInstanceCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: "/" });
}

/** The instance this request should read as. Owners honour their switcher cookie; everyone else gets their home instance. */
export function activeInstanceKey(request: FastifyRequest): string {
  const home = request.actor!.businessUnit;
  if (!request.actor!.isOwner) return home;
  const raw = request.cookies[COOKIE];
  if (!raw) return home;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : home;
}
