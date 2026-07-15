import type { FastifyRequest } from "fastify";
import { config } from "../config";

export const DEMO_AS_OF_HEADER = "x-demo-as-of";

/**
 * The demo clock (spec §8 UI requirements) lets a PL preview pool/evening
 * behavior at a different hour, but it only ever changed client-side display
 * — no server-computed value (capacity ranking, matching) ever reflected it,
 * because the server always used real wall-clock time. That mismatch is
 * what read as "pool weight not applied" / "logging a delivery doesn't
 * reliably reduce load": the numbers were live, just live for a different
 * hour than the one the demo clock implied.
 *
 * This lets the client pass the demo instant through, honored only when
 * DEV_AUTH is enabled — the same gate the demo clock itself is already
 * behind — so there is no path for a production deployment (DEV_AUTH always
 * false there) to have "now" dictated by a client.
 */
export function resolveNow(request: FastifyRequest): Date {
  if (config.devAuth) {
    const header = request.headers[DEMO_AS_OF_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return new Date();
}
