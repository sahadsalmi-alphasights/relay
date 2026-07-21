import { buildApp } from "./app";
import { config } from "./config";
import { hydratePermissionMatrix } from "./repositories/rolePermissions";

const app = buildApp();

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
