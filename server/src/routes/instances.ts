import type { FastifyPluginAsync } from "fastify";
import { badRequest, conflict } from "../errors";
import { insertAuditLog } from "../repositories/auditLog";
import { createInstance, findInstanceByKey, listInstances, slugifyInstanceKey } from "../repositories/instances";
import { applyImport, previewImport } from "../services/instanceImport";
import { diagnoseOktaDirectory, fetchOktaDirectory } from "../services/okta";
import { publish } from "../ws/hub";

/**
 * BU / instance registry — owner-only. GET is readable by any signed-in user
 * (the User-management BU dropdown needs the list); create is owner-only and
 * audit-logged, same as the rest of the admin portal.
 */
const instancesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.requireAuth] }, async () => listInstances());

  app.post<{ Body: { name?: string } }>("/", { preHandler: [app.requireOwner] }, async (request) => {
    const name = request.body?.name?.trim();
    if (!name) throw badRequest("instance name is required");
    const key = slugifyInstanceKey(name);
    if (!key) throw badRequest("instance name must contain a letter or number");
    if (await findInstanceByKey(key)) throw conflict(`an instance like "${name}" already exists`);

    const instance = await createInstance(name);
    await insertAuditLog({
      entityType: "instance",
      entityId: instance.id,
      actorId: request.actor!.id,
      action: "create_instance",
      newValue: { key: instance.key, name: instance.name },
    });
    return instance;
  });

  // Seed instances + users from OKTA — the source of truth. Each person's
  // (city, department, whiteboard_number) profile resolves to an instance the
  // SAME way the OIDC login does. Preview is read-only (nothing written) so an
  // owner can review the plan; apply performs it, idempotently, audit-logged.
  // Diagnostics: confirm the Okta directory is reachable and the attribute
  // values look right before importing.
  app.get("/import/fields", { preHandler: [app.requireOwner] }, async () => diagnoseOktaDirectory());

  app.get("/import/preview", { preHandler: [app.requireOwner] }, async () => previewImport(fetchOktaDirectory));

  app.post("/import/apply", { preHandler: [app.requireOwner] }, async (request) => {
    const result = await applyImport(request.actor!.id, fetchOktaDirectory);
    if (result.ok && ((result.usersCreated ?? 0) > 0 || (result.usersReassigned ?? 0) > 0)) {
      publish({ type: "people" });
      publish({ type: "capacity-ranking" });
    }
    return result;
  });
};

export default instancesRoutes;
