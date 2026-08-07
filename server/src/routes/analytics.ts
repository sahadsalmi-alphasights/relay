import type { FastifyPluginAsync } from "fastify";
import { badRequest } from "../errors";
import { auditByAction, frictionSignals, topUsers, usageByEvent, usageByTeam } from "../repositories/analytics";

/** Allowed rolling windows → days back. "all" reaches to the epoch. */
const WINDOWS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

function windowStartIso(window: string, now: number): string {
  const days = WINDOWS[window];
  if (days === null) return new Date(0).toISOString();
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Owner-only usage analytics. Aggregates telemetry (usage_event) and the audit
 * trail into "what's used" + "what shows friction", by team and by user.
 * requireOwner — this spans every team and every person, so it's the same
 * privileged surface as the rest of Settings, gated server-side (hiding the
 * tab in the UI is not authorization).
 */
const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { window?: string } }>("/", { preHandler: [app.requireOwner] }, async (request) => {
    const window = request.query.window ?? "30d";
    if (!(window in WINDOWS)) throw badRequest("window must be one of 7d, 30d, 90d, all");
    const from = windowStartIso(window, Date.now());

    const [usage, actions, byTeam, users, friction] = await Promise.all([
      usageByEvent(from),
      auditByAction(from),
      usageByTeam(from),
      topUsers(from),
      frictionSignals(from),
    ]);

    return {
      window,
      from,
      generatedAt: new Date().toISOString(),
      usageByEvent: usage,
      auditByAction: actions,
      byTeam,
      topUsers: users,
      friction,
    };
  });
};

export default analyticsRoutes;
