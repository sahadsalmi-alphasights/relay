import type { FastifyPluginAsync } from "fastify";
import { insertUsageEvents, MAX_BATCH, type IncomingUsageEvent } from "../repositories/usageEvents";

/**
 * Telemetry sink — any signed-in user POSTs a small batch of UI events here.
 * Deliberately cheap and forgiving: identity (person + team) and time are
 * stamped server-side from the session, unknown event names are dropped, and
 * it never throws user-visible errors (telemetry must never break the app).
 * NOT audit-logged — this is behavioural signal, not a mutation record.
 */
const usageEventsRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { events?: IncomingUsageEvent[] } }>(
    "/",
    // Generous per-route cap — clients batch, but a busy session still ticks.
    { preHandler: [app.requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request) => {
      const actor = request.actor!;
      const events = Array.isArray(request.body?.events) ? request.body!.events!.slice(0, MAX_BATCH) : [];
      if (events.length === 0) return { accepted: 0 };
      let accepted = 0;
      try {
        accepted = await insertUsageEvents(actor.id, actor.teamId ?? null, events);
      } catch {
        // Swallow — a telemetry write failing must never surface to the user.
      }
      return { accepted };
    }
  );
};

export default usageEventsRoutes;
