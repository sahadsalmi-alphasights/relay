import type { FastifyPluginAsync } from "fastify";
import { badRequest } from "../errors";
import { activeInstanceKey, setActiveInstanceCookie } from "../auth/activeInstance";
import { findInstanceByKey, listInstanceKeysForPerson, listInstances } from "../repositories/instances";

/**
 * Per-user view state — the instance switcher. `options` is what the person is
 * allowed to view (every instance for an owner; just their memberships
 * otherwise), and `active` is their current view. Only owners may switch.
 */
const meRoutes: FastifyPluginAsync = async (app) => {
  app.get("/instances", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    const all = await listInstances();
    // Owners may view any instance; everyone else only their memberships.
    let options = all;
    if (!actor.isOwner) {
      const memberKeys = new Set(await listInstanceKeysForPerson(actor.id));
      options = all.filter((i) => memberKeys.has(i.key));
    }
    return {
      active: activeInstanceKey(request),
      canSwitch: actor.isOwner,
      options: options.map((i) => ({ key: i.key, name: i.name })),
    };
  });

  app.post<{ Body: { key?: string } }>("/active-instance", { preHandler: [app.requireOwner] }, async (request, reply) => {
    const key = request.body?.key;
    if (!key || !(await findInstanceByKey(key))) throw badRequest("unknown instance");
    setActiveInstanceCookie(reply, key);
    return { active: key };
  });
};

export default meRoutes;
