import type { FastifyPluginAsync } from "fastify";
import { forbidden } from "../errors";
import { listAuditLog } from "../repositories/auditLog";
import { canViewAuditLog } from "../rules/permissions";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface AuditLogQuery {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

/**
 * Docs/AUDIT_LOG_SPEC.md — GET /audit-log (the spec's own worked example
 * shows `GET /api/audit-log`, but this app has never used an `/api` prefix
 * anywhere else — every existing route registers directly off root, e.g.
 * `/projects`, `/people` — so this follows that existing convention instead
 * of introducing the only `/api`-prefixed route in the app).
 */
const auditLogRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: AuditLogQuery }>("/", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    // Audit trails are sensitive and span every team, not just one project or
    // one team's roster -- there's no global "admin" role in this app (§7b's
    // is_manager is otherwise always team-scoped: canSetPersonStatus etc. all
    // check actor.teamId === target.teamId). Restricting to "any manager,
    // regardless of team" is the closest existing concept to "admin" and is
    // a deliberate call, not an oversight -- worth revisiting if a narrower
    // role is ever introduced.
    // Owner is a superset of Manager. Since 2026-07-21 this is the matrix key
    // "audit.view" (owners always pass; groups per the User-groups matrix).
    if (!canViewAuditLog(actor)) throw forbidden("your group does not have audit-log access");

    const q = request.query ?? {};
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(q.limit) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(q.offset) || 0);

    const { items, total } = await listAuditLog({
      entityType: q.entityType,
      entityId: q.entityId,
      actorId: q.actorId,
      action: q.action,
      from: q.from,
      to: q.to,
      limit,
      offset,
    });
    return { items, total };
  });
};

export default auditLogRoutes;
