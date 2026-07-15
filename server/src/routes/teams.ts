import type { FastifyPluginAsync } from "fastify";
import { listTeams } from "../repositories/teams";

const teamsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.requireAuth] }, async () => listTeams());
};

export default teamsRoutes;
