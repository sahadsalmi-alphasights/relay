import type { FastifyPluginAsync } from "fastify";
import { insertAuditLog } from "../repositories/auditLog";
import {
  getCoverageSettings,
  updateCoverageSettings,
  type CoverageSettings,
} from "../repositories/coverageSettings";
import { badRequest } from "../errors";
import { publish } from "../ws/hub";

// Field bounds. Times of day are minutes since midnight (0–1439); durations
// are a sane 1 minute … 8 hours.
const TIME_OF_DAY: (keyof CoverageSettings)[] = [
  "lunchPromptStartMin",
  "lunchPromptEndMin",
  "eveningPromptStartMin",
  "eveningPromptEndMin",
  "eveningResetStartMin",
  "eveningResetEndMin",
];
const DURATION: (keyof CoverageSettings)[] = ["lunchAutoOffMin", "lunchSnoozeMin", "eveningSnoozeMin"];
const WINDOW_PAIRS: [keyof CoverageSettings, keyof CoverageSettings, string][] = [
  ["lunchPromptStartMin", "lunchPromptEndMin", "lunch prompt"],
  ["eveningPromptStartMin", "eveningPromptEndMin", "evening prompt"],
  ["eveningResetStartMin", "eveningResetEndMin", "morning reset"],
];

const settingsRoutes: FastifyPluginAsync = async (app) => {
  // Readable by anyone signed in — the client prompts need the windows.
  app.get("/coverage", { preHandler: [app.requireAuth] }, async () => getCoverageSettings());

  // Owner-only, audit-logged (same gate as User management).
  app.patch<{ Body: Partial<CoverageSettings> }>(
    "/coverage",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const actor = request.actor!;
      const body = request.body ?? {};
      const patch: Partial<CoverageSettings> = {};

      for (const key of [...TIME_OF_DAY, ...DURATION] as (keyof CoverageSettings)[]) {
        const v = body[key];
        if (v === undefined) continue;
        if (!Number.isInteger(v)) throw badRequest(`${key} must be an integer`);
        if (TIME_OF_DAY.includes(key) && (v < 0 || v > 1439)) throw badRequest(`${key} must be 0–1439 (minutes of day)`);
        if (DURATION.includes(key) && (v < 1 || v > 480)) throw badRequest(`${key} must be 1–480 minutes`);
        patch[key] = v;
      }

      // Validate window ordering against the merged result (start < end).
      const current = await getCoverageSettings();
      const merged = { ...current, ...patch };
      for (const [start, end, label] of WINDOW_PAIRS) {
        if (merged[start] >= merged[end]) throw badRequest(`${label} start must be before its end`);
      }

      const updated = await updateCoverageSettings(patch);
      await insertAuditLog({
        entityType: "coverage_settings",
        // Singleton row — a fixed sentinel UUID (audit_log.entity_id is uuid).
        entityId: "00000000-0000-0000-0000-000000000001",
        actorId: actor.id,
        action: "coverage_settings_updated",
        oldValue: current,
        newValue: updated,
      });
      // Everyone's prompts + the scheduler read this — invalidate so it applies live.
      publish({ type: "settings" });
      return updated;
    }
  );
};

export default settingsRoutes;
