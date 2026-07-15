import type { FastifyPluginAsync } from "fastify";
import { markAlive, registerConnection, unregisterConnection } from "../ws/hub";

/**
 * §11 step 5 — the live-update socket. Auth reuses the exact same signed
 * session cookie as every REST route (`app.requireAuth`, run as this route's
 * preHandler): an unauthenticated request never completes the upgrade, it
 * just gets the normal 401 preHandler would send over plain HTTP.
 */
const wsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { websocket: true, preHandler: [app.requireAuth] }, (socket, request) => {
    const actor = request.actor!;
    const id = registerConnection(socket, actor.id);

    socket.on("pong", () => markAlive(id));
    socket.on("close", () => unregisterConnection(id));
    socket.on("error", () => unregisterConnection(id));
  });
};

export default wsRoutes;
