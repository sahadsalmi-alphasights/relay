import type { FastifyPluginAsync } from "fastify";
import { badRequest, conflict } from "../errors";
import { assignTeam } from "../repositories/people";
import { createTeam, findTeamById } from "../repositories/teams";

/** §7a — first-login onboarding: join an existing team, or create one (creator becomes manager). */
const onboardingRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { teamId?: string; newTeamName?: string } }>(
    "/team",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const actor = request.actor!;
      if (actor.teamId) throw conflict("already assigned to a team");

      const { teamId, newTeamName } = request.body ?? {};
      if (teamId) {
        const team = await findTeamById(teamId);
        if (!team) throw badRequest("unknown team");
        return assignTeam(actor.id, team.id, false);
      }
      if (newTeamName) {
        const team = await createTeam(newTeamName);
        return assignTeam(actor.id, team.id, true);
      }
      throw badRequest("teamId or newTeamName is required");
    }
  );
};

export default onboardingRoutes;
