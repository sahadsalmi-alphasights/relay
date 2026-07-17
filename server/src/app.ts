import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import authPlugin from "./auth/plugin";
import { config } from "./config";
import { pool } from "./db";
import { HttpError } from "./errors";
import anglesRoutes from "./routes/angles";
import assignmentsRoutes from "./routes/assignments";
import authRoutes from "./routes/auth";
import capacityRankingRoutes from "./routes/capacityRanking";
import goalChangeRequestsRoutes from "./routes/goalChangeRequests";
import notificationsRoutes from "./routes/notifications";
import onboardingRoutes from "./routes/onboarding";
import peopleRoutes from "./routes/people";
import projectsRoutes from "./routes/projects";
import pushRoutes from "./routes/push";
import sundayRotaRoutes from "./routes/sundayRota";
import sundaySwapRequestsRoutes from "./routes/sundaySwapRequests";
import teamsRoutes from "./routes/teams";
import wsRoutes from "./routes/ws";
import { startHeartbeat } from "./ws/hub";
import { startStaleScheduler } from "./services/staleScheduler";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  // The web app runs on a different port (different origin); cookies need
  // an exact origin + credentials:true, not a wildcard.
  app.register(cors, { origin: config.webOrigin, credentials: true });
  app.register(authPlugin);
  app.register(websocketPlugin);

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    request.log.error(err);
    reply.code(500).send({ error: "internal_error" });
  });

  app.get("/", async () => ({ name: "relay-api" }));
  app.get("/health", async () => {
    const { rows } = await pool.query("SELECT 1 AS ok");
    return { status: "ok", db: rows[0].ok === 1 };
  });

  app.register(authRoutes, { prefix: "/auth" });
  app.register(onboardingRoutes, { prefix: "/onboarding" });
  app.register(peopleRoutes, { prefix: "/people" });
  app.register(teamsRoutes, { prefix: "/teams" });
  app.register(projectsRoutes, { prefix: "/projects" });
  app.register(anglesRoutes, { prefix: "/angles" });
  app.register(assignmentsRoutes, { prefix: "/assignments" });
  app.register(goalChangeRequestsRoutes, { prefix: "/goal-change-requests" });
  app.register(sundayRotaRoutes, { prefix: "/sunday-rota" });
  app.register(sundaySwapRequestsRoutes, { prefix: "/sunday-swap-requests" });
  app.register(capacityRankingRoutes, { prefix: "/capacity-ranking" });
  app.register(wsRoutes, { prefix: "/ws" });
  app.register(notificationsRoutes, { prefix: "/notifications" });
  app.register(pushRoutes, { prefix: "/push" });

  const heartbeatTimer = startHeartbeat();
  const staleTimer = startStaleScheduler();
  app.addHook("onClose", (_instance, done) => {
    clearInterval(heartbeatTimer);
    clearInterval(staleTimer);
    done();
  });

  return app;
}
