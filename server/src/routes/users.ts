import type { FastifyPluginAsync } from "fastify";
import { config } from "../config";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { insertAuditLog } from "../repositories/auditLog";
import {
  createUser,
  deletePersonCascade,
  findPersonById,
  LeadsProjectsError,
  listPeopleAdmin,
  roleOf,
  setDeactivated,
  setRole,
  updateProfile,
  type Role,
} from "../repositories/people";
import { publish } from "../ws/hub";
import type { PersonStatus } from "../rules/types";
import { getPermissionMatrix, PERMISSION_KEYS, type PermissionKey } from "../rules/permissionMatrix";
import { hydratePermissionMatrix, savePermission } from "../repositories/rolePermissions";

const ROLES: Role[] = ["owner", "manager", "member"];
const STATUSES: PersonStatus[] = ["Available", "On vacation", "Sick", "Offline"];

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

  /**
   * User groups → permission matrix. GET re-hydrates from the DB so the page
   * always shows stored truth; PATCH flips one (role, key) cell. Owner rows
   * don't exist — owners always hold every permission in code — and the
   * portal itself is owner-only and not adjustable, so the matrix can never
   * create a lockout.
   */
  app.get("/permissions", { preHandler: [app.requireOwner] }, async () => {
    await hydratePermissionMatrix();
    return { matrix: getPermissionMatrix(), keys: PERMISSION_KEYS };
  });

  app.patch<{ Body: { role?: string; key?: string; allowed?: boolean } }>(
    "/permissions",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const { role, key, allowed } = request.body ?? {};
      if (role !== "manager" && role !== "member") {
        throw badRequest("role must be manager or member — owners always have every permission");
      }
      if (!key || !(PERMISSION_KEYS as readonly string[]).includes(key)) {
        throw badRequest("unknown permission key");
      }
      if (typeof allowed !== "boolean") throw badRequest("allowed must be a boolean");

      const permKey = key as PermissionKey;
      const before = getPermissionMatrix()[role][permKey];
      await savePermission(role, permKey, allowed);
      await insertAuditLog({
        entityType: "role_permission",
        entityId: `${role}:${permKey}`,
        actorId: request.actor!.id,
        action: "set_permission",
        oldValue: { allowed: before },
        newValue: { allowed },
      });
      return { matrix: getPermissionMatrix() };
    }
  );

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
    Body: { name?: string; practiceArea?: string | null; teamId?: string | null; status?: PersonStatus };
  }>("/:id", { preHandler: [app.requireOwner] }, async (request) => {
    const actor = request.actor!;
    const target = await findPersonById(request.params.id);
    if (!target) throw notFound("unknown person");

    const { name, practiceArea, teamId, status } = request.body ?? {};
    if (name !== undefined && name.trim() === "") throw badRequest("name cannot be empty");
    if (status !== undefined && !STATUSES.includes(status)) throw badRequest("invalid status");

    const updated = await updateProfile(target.id, { name, practiceArea, teamId, status });
    await insertAuditLog({
      entityType: "person",
      entityId: target.id,
      actorId: actor.id,
      action: "profile_update",
      oldValue: {
        name: target.name,
        practiceArea: target.practiceArea,
        teamId: target.teamId,
        status: target.status,
      },
      newValue: {
        name: updated.name,
        practiceArea: updated.practiceArea,
        teamId: updated.teamId,
        status: updated.status,
      },
    });
    return updated;
  });

  // Pre-provision a user by email so their role/team are ready the first time
  // they sign in via SSO (findOrCreatePersonByEmail matches on email).
  app.post<{ Body: { email?: string; name?: string; role?: Role; teamId?: string | null } }>(
    "/",
    { preHandler: [app.requireOwner] },
    async (request, reply) => {
      const actor = request.actor!;
      const { email, name, role, teamId } = request.body ?? {};
      if (!email || email.trim() === "") throw badRequest("email is required");
      if (!name || name.trim() === "") throw badRequest("name is required");
      if (role && !ROLES.includes(role)) throw badRequest("invalid role");

      let created;
      try {
        created = await createUser(email.trim(), name.trim());
      } catch {
        throw badRequest("a user with that email already exists");
      }
      if (role && role !== "member") created = await setRole(created.id, role);
      if (teamId) created = await updateProfile(created.id, { teamId });

      await insertAuditLog({
        entityType: "person",
        entityId: created.id,
        actorId: actor.id,
        action: "create",
        newValue: { email: created.email, name: created.name, role: roleOf(created), teamId: created.teamId },
      });
      reply.code(201);
      return created;
    }
  );

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

  /**
   * Hard delete with cascade: the person's footprint (assignments, rounds,
   * goal-change requests, notes, rota entries, notifications, push subs)
   * goes with them; audit rows are kept, unattributed. If they still lead
   * projects, the client must pass ?reassignPlTo=<personId> — the portal
   * shows a picker on the 409 — and the projects move to the new PL in the
   * same transaction as the delete.
   */
  app.delete<{ Params: { id: string }; Querystring: { reassignPlTo?: string } }>(
    "/:id",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const actor = request.actor!;
      const target = await findPersonById(request.params.id);
      if (!target) throw notFound("unknown person");
      if (target.id === actor.id) throw badRequest("you cannot delete yourself");
      if (isAllowlistedOwner(target.email)) throw forbidden("a permanent owner (allowlist) cannot be deleted");

      const reassignPlTo = request.query?.reassignPlTo || undefined;
      if (reassignPlTo) {
        const newPl = await findPersonById(reassignPlTo);
        if (!newPl) throw badRequest("unknown reassignment target");
        if (newPl.id === target.id) throw badRequest("cannot reassign projects to the person being deleted");
        if (newPl.deactivatedAt) throw badRequest("the reassignment target is deactivated");
      }

      let summary;
      try {
        summary = await deletePersonCascade(target.id, reassignPlTo);
      } catch (err) {
        if (err instanceof LeadsProjectsError) {
          throw conflict(
            `${target.name} leads ${err.count} project${err.count === 1 ? "" : "s"} — choose who should take them over`
          );
        }
        if ((err as { code?: string }).code === "23503") {
          throw conflict(`${target.name} has data this delete doesn't cover yet — deactivate instead`);
        }
        throw err;
      }
      await insertAuditLog({
        entityType: "person",
        entityId: target.id,
        actorId: actor.id,
        action: "delete_user",
        oldValue: { email: target.email, name: target.name, role: roleOf(target) },
        newValue: { ...summary, projectsReassignedTo: reassignPlTo ?? null },
      });
      publish({ type: "people" });
      publish({ type: "capacity-ranking" });
      return { ok: true, ...summary };
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
