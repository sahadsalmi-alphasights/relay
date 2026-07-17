import type { FastifyPluginAsync } from "fastify";
import { config } from "../config";
import { badRequest, forbidden, notFound } from "../errors";
import { insertAuditLog } from "../repositories/auditLog";
import {
  findPersonById,
  listPeopleAdmin,
  roleOf,
  setDeactivated,
  setRole,
  updateProfile,
  type Role,
} from "../repositories/people";

const ROLES: Role[] = ["owner", "manager", "member"];

function isAllowlistedOwner(email: string): boolean {
  return config.ownerEmails.includes(email.toLowerCase());
}

/**
 * User management portal API — OWNER only (app.requireOwner on every route).
 * Every mutation writes an audit_log entry so role/access changes are
 * attributable, same as the rest of the app.
 */
const usersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.requireOwner] }, async () => {
    return listPeopleAdmin();
  });

  app.patch<{ Params: { id: string }; Body: { role?: Role } }>(
    "/:id/role",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const actor = request.actor!;
      const { role } = request.body ?? {};
      if (!role || !ROLES.includes(role)) throw badRequest("role must be one of owner, manager, member");

      const target = await findPersonById(request.params.id);
      if (!target) throw notFound("unknown person");

      // Allowlisted founders are always Owner (the OIDC callback re-grants it
      // on next login anyway); refuse a demotion to avoid a confusing no-op.
      if (isAllowlistedOwner(target.email) && role !== "owner") {
        throw forbidden("this account is a permanent owner (allowlist) and cannot be demoted");
      }

      const before = roleOf(target);
      const updated = await setRole(target.id, role);
      await insertAuditLog({
        entityType: "person",
        entityId: target.id,
        actorId: actor.id,
        action: "role_change",
        oldValue: { role: before },
        newValue: { role },
      });
      return updated;
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: string; practiceArea?: string | null; teamId?: string | null };
  }>("/:id", { preHandler: [app.requireOwner] }, async (request) => {
    const actor = request.actor!;
    const target = await findPersonById(request.params.id);
    if (!target) throw notFound("unknown person");

    const { name, practiceArea, teamId } = request.body ?? {};
    if (name !== undefined && name.trim() === "") throw badRequest("name cannot be empty");

    const updated = await updateProfile(target.id, { name, practiceArea, teamId });
    await insertAuditLog({
      entityType: "person",
      entityId: target.id,
      actorId: actor.id,
      action: "profile_update",
      oldValue: { name: target.name, practiceArea: target.practiceArea, teamId: target.teamId },
      newValue: { name: updated.name, practiceArea: updated.practiceArea, teamId: updated.teamId },
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>(
    "/:id/deactivate",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const actor = request.actor!;
      const target = await findPersonById(request.params.id);
      if (!target) throw notFound("unknown person");
      if (target.id === actor.id) throw badRequest("you cannot deactivate yourself");
      if (isAllowlistedOwner(target.email)) throw forbidden("a permanent owner (allowlist) cannot be deactivated");

      const updated = await setDeactivated(target.id, true);
      await insertAuditLog({
        entityType: "person",
        entityId: target.id,
        actorId: actor.id,
        action: "deactivate",
        oldValue: { deactivatedAt: target.deactivatedAt },
        newValue: { deactivatedAt: updated.deactivatedAt },
      });
      return updated;
    }
  );

  app.post<{ Params: { id: string } }>(
    "/:id/reactivate",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const actor = request.actor!;
      const target = await findPersonById(request.params.id);
      if (!target) throw notFound("unknown person");

      const updated = await setDeactivated(target.id, false);
      await insertAuditLog({
        entityType: "person",
        entityId: target.id,
        actorId: actor.id,
        action: "reactivate",
        oldValue: { deactivatedAt: target.deactivatedAt },
        newValue: { deactivatedAt: null },
      });
      return updated;
    }
  );
};

export default usersRoutes;
