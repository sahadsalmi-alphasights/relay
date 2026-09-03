import { buildApp } from "./app";
import { config } from "./config";
import { pool } from "./db";
import { hydratePermissionMatrix } from "./repositories/rolePermissions";

const app = buildApp();

// Graceful shutdown. A deploy recreates the container, so the old process gets
// a SIGTERM (SIGINT for a local Ctrl-C). Without a handler Node would exit
// immediately, cutting off any in-flight HTTP request, dropping open
// WebSockets, and abandoning the pg pool mid-query. Here we instead:
//   1. app.close() — stop accepting new connections and let in-flight requests
//      finish; this fires the onClose hook (clears timers, closes WebSockets).
//   2. pool.end() — drain the DB pool once no request needs it.
// Guarded so a second signal (or a failed close) can't hang the box forever:
// a hard-exit timer forces the process down if the drain overruns.
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received — draining before exit`);

  // Backstop: if the drain stalls (a wedged request, a stuck socket), don't
  // sit until the orchestrator SIGKILLs us — exit non-zero after the grace
  // window. Unref'd so it never keeps the process alive on its own.
  const forceExit = setTimeout(() => {
    app.log.error("graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await app.close();
    await pool.end();
    clearTimeout(forceExit);
    app.log.info("drain complete — exiting");
    process.exit(0);
  } catch (err) {
    app.log.error(err, "error during graceful shutdown");
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Load the User-groups permission matrix before serving; on failure the
// in-process defaults (pre-matrix behavior) stay active rather than failing
// the boot — authorization never goes darker than the defaults.
hydratePermissionMatrix().catch((err) => {
  app.log.warn({ err }, "permission matrix hydration failed — using built-in defaults");
});

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => app.log.info(`relay-api listening on ${config.port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
