import { config } from "../config";
import { getNotificationSettings, type NotificationSettings } from "../repositories/notificationSettings";

/** True when a Slack webhook is configured in env. The URL itself is never exposed. */
export function slackConfigured(): boolean {
  return !!config.slackWebhookUrl;
}

/**
 * Maps a notification `type` to the per-event Slack toggle. Types with no
 * mapping (should be none) simply never post to Slack.
 */
const EVENT_TOGGLE: Record<string, keyof NotificationSettings> = {
  open_pool: "slackBroadcastUpForGrabs",
  assigned: "slackAssigned",
  goal_change_requested: "slackGoalChangeRequested",
  goal_change_resolved: "slackGoalChangeResolved",
  delivery_logged: "slackDeliveryLogged",
  stale_first_deliverable: "slackStaleFirstDeliverable",
  project_transferred: "slackProjectTransferred",
};

/** Whether this notification type should post to Slack given the settings. */
export function slackEventEnabled(settings: NotificationSettings, type: string): boolean {
  if (!settings.slackEnabled) return false;
  const key = EVENT_TOGGLE[type];
  return key ? settings[key] : false;
}

/** Slack mrkdwn for a notification. Kept to the same copy the in-app bell shows. */
export function formatSlackMessage(title: string, body: string): string {
  return `*${title}*\n${body}`;
}

/**
 * POST text to the configured Slack Incoming Webhook. Fire-and-forget and
 * fully guarded — a Slack outage must never break (or slow) an in-app
 * notification. Returns true only on a 2xx.
 */
export async function postToSlack(text: string): Promise<boolean> {
  if (!config.slackWebhookUrl) return false;
  try {
    const res = await fetch(config.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Called from notify() for every notification. Posts to Slack only when the
 * webhook is configured (env), the master switch is on, and this event's
 * toggle is on. Never throws.
 */
export async function maybeNotifySlack(type: string, title: string, body: string): Promise<void> {
  if (!slackConfigured()) return;
  try {
    const settings = await getNotificationSettings();
    if (!slackEventEnabled(settings, type)) return;
    await postToSlack(formatSlackMessage(title, body));
  } catch {
    // never let Slack delivery affect the in-app notification path
  }
}
