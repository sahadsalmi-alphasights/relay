import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocketPlugin from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import authPlugin from "./auth/plugin";
import { config } from "./config";
import { pool } from "./db";
import { HttpError } from "./errors";
import anglesRoutes from "./routes/angles";
import assignmentsRoutes from "./routes/assignments";
import auditLogRoutes from "./routes/auditLog";
import usersRoutes from "./routes/users";
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
import { startBroadcastRepingScheduler } from "./services/broadcast";

export function buildApp(): FastifyInstance {
  // trustProxy: every production request arrives via nginx (which itself sits
  // behind the Cloudflare tunnel), so the socket address is always the proxy —
  // X-Forwarded-For is what carries the real client. The origin is not
  // directly reachable, so the header can't be spoofed from outside.
  const app = Fastify({ logger: true, trustProxy: true });

  // The web app runs on a different port (different origin); cookies need
  // an exact origin + credentials:true, not a wildcard. Methods are explicit
  // because @fastify/cors v10+ defaults to the CORS-safelisted set
  // (GET,HEAD,POST) — which silently breaks the app's PATCH/DELETE routes in
  // any cross-origin setup (local dev; production is same-origin via nginx).
  app.register(cors, {
    origin: config.webOrigin,
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  });
  app.register(authPlugin);
  app.register(websocketPlugin);

  // Production only, same gating pattern as the capacity-ranking cache: the
  // integration tests fire hundreds of requests from one address and would
  // trip any limit worth having. Keyed per authenticated user first — the
  // whole office shares one egress IP, so an IP bucket would throttle
  // everyone collectively during busy hours. The auth plugin registers its
  // onRequest hook before this one, so request.actor is already resolved.
  // Unauthenticated traffic (login flows) falls back to the
  // Cloudflare-reported client IP, then the trustProxy-resolved one.
  if (config.nodeEnv === "production") {
    app.register(rateLimit, {
      max: 300,
      timeWindow: "1 minute",
      keyGenerator: (request) =>
        request.actor?.id ??
        (request.headers["cf-connecting-ip"] as string | undefined) ??
        request.ip,
    });
  }

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
  app.register(auditLogRoutes, { prefix: "/audit-log" });
  app.register(usersRoutes, { prefix: "/users" });

  const heartbeatTimer = startHeartbeat();
  const staleTimer = startStaleScheduler();
  const broadcastRepingTimer = startBroadcastRepingScheduler();
  app.addHook("onClose", (_instance, done) => {
    clearInterval(heartbeatTimer);
    clearInterval(staleTimer);
    clearInterval(broadcastRepingTimer);
    done();
  });

  return app;
}
