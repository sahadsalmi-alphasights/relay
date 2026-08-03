import type { FastifyPluginAsync } from "fastify";
import { insertAuditLog } from "../repositories/auditLog";
import {
  getCoverageSettings,
  updateCoverageSettings,
  type CoverageSettings,
} from "../repositories/coverageSettings";
import {
  getNotificationSettings,
  updateNotificationSettings,
  NOTIFICATION_SETTING_KEYS,
  type NotificationSettings,
} from "../repositories/notificationSettings";
import { dmSampleToPerson, formatSlackMessage, postToSlack, postSampleNotifications, SAMPLE_EVENT_KEYS, slackConfigured, slackDmConfigured, slackInteractiveConfigured } from "../services/slack";
import { findPersonById } from "../repositories/people";
import {
  getHrIntegrationSettings,
  updateHrIntegrationSettings,
  type HrIntegrationSettingsPatch,
} from "../repositories/hrIntegrationSettings";
import { hrConfigured, fetchDirectoryEmails } from "../services/bamboohr";
import { runHrLeaveSync } from "../services/hrLeaveSync";
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

  // --- Notification / Slack settings ---
  // Readable by anyone signed in; exposes only the non-secret toggles plus a
  // boolean saying whether a Slack webhook is configured in env (never the URL).
  app.get("/notifications", { preHandler: [app.requireAuth] }, async () => {
    const settings = await getNotificationSettings();
    return { ...settings, slackConfigured: slackConfigured(), slackInteractiveConfigured: slackInteractiveConfigured(), slackDmConfigured: slackDmConfigured() };
  });

  app.patch<{ Body: Partial<NotificationSettings> }>(
    "/notifications",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const actor = request.actor!;
      const body = request.body ?? {};
      const patch: Partial<NotificationSettings> = {};
      for (const key of NOTIFICATION_SETTING_KEYS) {
        const v = body[key];
        if (v === undefined) continue;
        if (typeof v !== "boolean") throw badRequest(`${key} must be a boolean`);
        patch[key] = v;
      }
      const current = await getNotificationSettings();
      const updated = await updateNotificationSettings(patch);
      await insertAuditLog({
        entityType: "notification_settings",
        entityId: "00000000-0000-0000-0000-000000000002",
        actorId: actor.id,
        action: "notification_settings_updated",
        oldValue: current,
        newValue: updated,
      });
      publish({ type: "settings" });
      return { ...updated, slackConfigured: slackConfigured(), slackInteractiveConfigured: slackInteractiveConfigured(), slackDmConfigured: slackDmConfigured() };
    }
  );

  // Owner-only "send a test message" — proves the webhook works end to end.
  app.post("/notifications/test", { preHandler: [app.requireOwner] }, async (request) => {
    if (!slackConfigured()) throw badRequest("Slack is not configured (SLACK_WEBHOOK_URL is not set on the server)");
    const ok = await postToSlack(formatSlackMessage("CapTracker test message", `Sent by ${request.actor!.name}. If you can see this, Slack is wired up correctly.`));
    return { ok };
  });

  // Owner-only "send a sample of each event" — posts one example of every
  // notification type to the channel so the team can preview them. Ignores the
  // per-event toggles (it's a manual preview).
  app.post("/notifications/sample-all", { preHandler: [app.requireOwner] }, async (request) => {
    if (!slackConfigured()) throw badRequest("Slack is not configured (SLACK_WEBHOOK_URL is not set on the server)");
    const sent = await postSampleNotifications(request.actor!.name);
    return { ok: sent > 0, sent };
  });

  // Owner-only "DM me a test" — sends a sample of one alert type (by key) or
  // all of them as a direct message to the requester, so they can preview
  // exactly what an individual receives. Needs a bot token (DM mode).
  app.post<{ Body: { event?: string } }>(
    "/notifications/sample-dm",
    { preHandler: [app.requireOwner] },
    async (request) => {
      if (!slackDmConfigured()) {
        throw badRequest("Per-person DMs aren't configured (SLACK_BOT_TOKEN is not set on the server)");
      }
      const event = request.body?.event;
      if (event && event !== "all" && !SAMPLE_EVENT_KEYS.includes(event)) {
        throw badRequest("unknown event");
      }
      const me = await findPersonById(request.actor!.id);
      if (!me?.email) throw badRequest("your account has no email to DM");
      const sent = await dmSampleToPerson(me.email, event && event !== "all" ? event : undefined);
      if (sent === 0) {
        return { ok: false, sent, hint: "No DM sent — check the bot has chat:write + users:read.email (reinstalled) and your Slack email matches." };
      }
      return { ok: true, sent };
    }
  );

  // ---- BambooHR leave sync (Integrations) -------------------------------
  // Readable by any signed-in user; `configured` reflects whether the env
  // credentials are set (the key itself is never sent).
  app.get("/hr-integration", { preHandler: [app.requireAuth] }, async () => {
    const settings = await getHrIntegrationSettings();
    return { ...settings, configured: hrConfigured() };
  });

  // Owner-only, audit-logged. Only `enabled` and `leaveTypeKeywords` are editable.
  app.patch<{ Body: HrIntegrationSettingsPatch }>(
    "/hr-integration",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const actor = request.actor!;
      const body = request.body ?? {};
      const patch: HrIntegrationSettingsPatch = {};
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean") throw badRequest("enabled must be a boolean");
        patch.enabled = body.enabled;
      }
      if (body.leaveTypeKeywords !== undefined) {
        if (typeof body.leaveTypeKeywords !== "string") throw badRequest("leaveTypeKeywords must be a string");
        const cleaned = body.leaveTypeKeywords.trim();
        if (!cleaned) throw badRequest("leaveTypeKeywords cannot be empty");
        patch.leaveTypeKeywords = cleaned;
      }
      const current = await getHrIntegrationSettings();
      const updated = await updateHrIntegrationSettings(patch);
      await insertAuditLog({
        entityType: "hr_integration_settings",
        entityId: "00000000-0000-0000-0000-000000000003",
        actorId: actor.id,
        action: "hr_integration_settings_updated",
        oldValue: current,
        newValue: updated,
      });
      publish({ type: "settings" });
      return { ...updated, configured: hrConfigured() };
    }
  );

  // Owner-only "sync now" — runs a pass immediately and returns what it did.
  app.post("/hr-integration/sync", { preHandler: [app.requireOwner] }, async () => {
    if (!hrConfigured()) {
      throw badRequest("BambooHR is not configured (BAMBOOHR_API_KEY / BAMBOOHR_SUBDOMAIN are not set on the server)");
    }
    const result = await runHrLeaveSync(new Date());
    return result;
  });

  // Owner-only connection test — hits the directory endpoint to prove the
  // credentials work, without changing anyone's status.
  app.post("/hr-integration/test", { preHandler: [app.requireOwner] }, async () => {
    if (!hrConfigured()) {
      throw badRequest("BambooHR is not configured (BAMBOOHR_API_KEY / BAMBOOHR_SUBDOMAIN are not set on the server)");
    }
    const directory = await fetchDirectoryEmails();
    return { ok: directory !== null, employees: directory?.size ?? 0 };
  });
};

export default settingsRoutes;
