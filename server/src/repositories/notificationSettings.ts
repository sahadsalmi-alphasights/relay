import { pool } from "../db";

export interface NotificationSettings {
  slackEnabled: boolean;
  slackBroadcastUpForGrabs: boolean;
  slackAssigned: boolean;
  slackGoalChangeRequested: boolean;
  slackGoalChangeResolved: boolean;
  slackDeliveryLogged: boolean;
  slackStaleFirstDeliverable: boolean;
  slackProjectTransferred: boolean;
}

const SELECT = `
  SELECT slack_enabled                  AS "slackEnabled",
         slack_broadcast_up_for_grabs   AS "slackBroadcastUpForGrabs",
         slack_assigned                 AS "slackAssigned",
         slack_goal_change_requested    AS "slackGoalChangeRequested",
         slack_goal_change_resolved     AS "slackGoalChangeResolved",
         slack_delivery_logged          AS "slackDeliveryLogged",
         slack_stale_first_deliverable  AS "slackStaleFirstDeliverable",
         slack_project_transferred      AS "slackProjectTransferred"
  FROM notification_settings WHERE id = 1`;

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const { rows } = await pool.query<NotificationSettings>(SELECT);
  return rows[0];
}

/** camelCase field -> snake column; the only fields a PATCH may touch (mass-assignment guard). */
const COLUMN: Record<keyof NotificationSettings, string> = {
  slackEnabled: "slack_enabled",
  slackBroadcastUpForGrabs: "slack_broadcast_up_for_grabs",
  slackAssigned: "slack_assigned",
  slackGoalChangeRequested: "slack_goal_change_requested",
  slackGoalChangeResolved: "slack_goal_change_resolved",
  slackDeliveryLogged: "slack_delivery_logged",
  slackStaleFirstDeliverable: "slack_stale_first_deliverable",
  slackProjectTransferred: "slack_project_transferred",
};

export const NOTIFICATION_SETTING_KEYS = Object.keys(COLUMN) as (keyof NotificationSettings)[];

export async function updateNotificationSettings(
  fields: Partial<NotificationSettings>
): Promise<NotificationSettings> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of NOTIFICATION_SETTING_KEYS) {
    const v = fields[key];
    if (v !== undefined) {
      vals.push(v);
      sets.push(`${COLUMN[key]} = $${vals.length}`);
    }
  }
  if (sets.length > 0) {
    await pool.query(`UPDATE notification_settings SET ${sets.join(", ")}, updated_at = now() WHERE id = 1`, vals);
  }
  return getNotificationSettings();
}
