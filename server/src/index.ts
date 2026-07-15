import { buildApp } from "./app";
import { config } from "./config";

const app = buildApp();

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => app.log.info(`relay-api listening on ${config.port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
