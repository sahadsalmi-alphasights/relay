import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocketPlugin from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import authPlugin from "./auth/plugin";
import cloudflareAccessPlugin from "./auth/cloudflareAccess";
import { config } from "./config";
import { pool } from "./db";
import { HttpError } from "./errors";
import analyticsRoutes from "./routes/analytics";
import anglesRoutes from "./routes/angles";
import assignmentsRoutes from "./routes/assignments";
import auditLogRoutes from "./routes/auditLog";
import instancesRoutes from "./routes/instances";
import meRoutes from "./routes/me";
import usageEventsRoutes from "./routes/usageEvents";
import vacationRoutes from "./routes/vacation";
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
import settingsRoutes from "./routes/settings";
import slackRoutes from "./routes/slack";
import sundaySwapRequestsRoutes from "./routes/sundaySwapRequests";
import teamsRoutes from "./routes/teams";
import wsRoutes from "./routes/ws";
import { startHeartbeat } from "./ws/hub";
import { startStaleScheduler } from "./services/staleScheduler";
import { startAdminAutoArchiveScheduler } from "./services/adminAutoArchive";
import { startBroadcastRepingScheduler } from "./services/broadcast";
import { startDailyResetScheduler } from "./services/dailyReset";
import { startHrSyncScheduler } from "./services/hrSyncScheduler";

export function buildApp(): FastifyInstance {
  // trustProxy: every production request arrives via nginx (which itself sits
  // behind the Cloudflare tunnel), so the socket address is always the proxy —
  // X-Forwarded-For is what carries the real client. The origin is not
  // directly reachable, so the header can't be spoofed from outside.
  // Defense-in-depth request bounds (OWASP API4 — unrestricted resource
  // consumption). bodyLimit: every endpoint here takes small JSON (notes,
  // stepper deltas, intake) — 256 KB is far above any real payload and well
  // under Fastify's 1 MB default, shrinking the DoS surface. requestTimeout
  // hangs up on a slow-loris client that opens a request and never finishes
  // it. Both are global; no route needs more.
  const app = Fastify({
    logger: true,
    trustProxy: true,
    bodyLimit: 256 * 1024,
    requestTimeout: 30_000,
  });

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
  // Defense in depth — verifies the Cloudflare Access assertion at the origin.
  // Inert unless CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD are set (default off).
  app.register(cloudflareAccessPlugin);
  app.register(websocketPlugin);

  // Global rate limiting — registered in EVERY environment so it's always
  // applied (and statically provable: previously this was wrapped in an
  // `if (production)`, which is why CodeQL flagged every DB-touching route as
  // un-rate-limited). Production keeps the real 300/min cap; other envs get an
  // effectively-unlimited ceiling so the integration suite (hundreds of
  // requests) is never throttled, while the limiter is genuinely in the chain.
  // Keyed per authenticated user first — the whole office shares one egress
  // IP, so an IP bucket would throttle everyone collectively during busy
  // hours. The auth plugin registers its onRequest hook before this one, so
  // request.actor is already resolved; unauthenticated traffic (login flows)
  // falls back to the Cloudflare-reported client IP, then the trustProxy IP.
  app.register(rateLimit, {
    global: true,
    max: config.nodeEnv === "production" ? 300 : 1_000_000,
    timeWindow: "1 minute",
    keyGenerator: (request) =>
      request.actor?.id ??
      (request.headers["cf-connecting-ip"] as string | undefined) ??
      request.ip,
  });

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
  app.register(settingsRoutes, { prefix: "/settings" });
  app.register(slackRoutes, { prefix: "/slack" });
  app.register(usageEventsRoutes, { prefix: "/usage-events" });
  app.register(analyticsRoutes, { prefix: "/analytics" });
  app.register(instancesRoutes, { prefix: "/instances" });
  app.register(meRoutes, { prefix: "/me" });
  app.register(vacationRoutes, { prefix: "/vacation" });

  const heartbeatTimer = startHeartbeat();
  const staleTimer = startStaleScheduler();
  const broadcastRepingTimer = startBroadcastRepingScheduler();
  const dailyResetTimer = startDailyResetScheduler();
  const hrSyncTimer = startHrSyncScheduler();
  const adminAutoArchiveTimer = startAdminAutoArchiveScheduler();
  app.addHook("onClose", (_instance, done) => {
    clearInterval(heartbeatTimer);
    clearInterval(staleTimer);
    clearInterval(broadcastRepingTimer);
    clearInterval(dailyResetTimer);
    clearInterval(hrSyncTimer);
    clearInterval(adminAutoArchiveTimer);
    done();
  });

  return app;
}
