import type { FastifyPluginAsync } from "fastify";
import { resolveNow } from "../lib/requestTime";
import { listAvailableCandidatesWithAssignments, sundayRotaPersonIdsForDate } from "../services/candidates";
import { isEligible } from "../rules/eligibility";
import { personLoad, personRawRemaining } from "../rules/load";
import { median } from "../rules/median";
import { dubaiDateKey, dubaiHour } from "../rules/time";

/**
 * §8.3 — visible to everyone, org-wide (not team-private, confirmed with the
 * product owner). It replaces a shared spreadsheet everyone could already see.
 */
const capacityRankingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.requireAuth] }, async (request) => {
    const now = resolveNow(request);
    const hour = dubaiHour(now);
    const rotaSet = await sundayRotaPersonIdsForDate(dubaiDateKey(now));
    const people = await listAvailableCandidatesWithAssignments();
    const rawRemainders = people.map((p) => personRawRemaining(p.assignments));
    const med = median(rawRemainders);

    const ranked = people.map((p) => {
      const elig = isEligible(
        { id: p.id, status: p.status, eveningCoverage: p.eveningCoverage },
        { now, sundayRotaPersonIds: rotaSet }
      );
      return {
        personId: p.id,
        practiceArea: p.practiceArea,
        load: personLoad(p.assignments, hour),
        rawRemaining: personRawRemaining(p.assignments),
        free: personRawRemaining(p.assignments) <= med,
        eligible: elig.eligible,
      };
    });
    ranked.sort((a, b) => a.load - b.load);
    return ranked;
  });
};

export default capacityRankingRoutes;
