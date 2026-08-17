import type { FastifyPluginAsync } from "fastify";
import { badRequest, conflict } from "../errors";
import { insertAuditLog } from "../repositories/auditLog";
import { createInstance, findInstanceByKey, listInstances, slugifyInstanceKey } from "../repositories/instances";

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
};

export default instancesRoutes;
