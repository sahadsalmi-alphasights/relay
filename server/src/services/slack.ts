import { config } from "../config";
import { getNotificationSettings, type NotificationSettings } from "../repositories/notificationSettings";
import { findPersonById } from "../repositories/people";

/** True when a Slack webhook is configured in env. The URL itself is never exposed. */
export function slackConfigured(): boolean {
  return !!config.slackWebhookUrl;
}

/** True when a bot token is configured — enables per-person DMs. The token is never exposed. */
export function slackDmConfigured(): boolean {
  return !!config.slackBotToken;
}

/** Events that belong in the shared channel, not a personal DM. */
const TEAM_EVENTS = new Set<string>(["open_pool"]);

export type SlackRoute = "dm" | "channel" | "skip";

/**
 * Where a notification's Slack copy should go — the pure routing decision.
 * - No bot token (legacy): everything goes to the channel webhook.
 * - Bot token (DM mode): team events (broadcasts) are skipped here (the
 *   broadcast path posts them to the channel once), everything else DMs the
 *   individual recipient.
 */
export function slackRouteFor(type: string, dmMode: boolean): SlackRoute {
  if (!dmMode) return "channel";
  if (TEAM_EVENTS.has(type)) return "skip";
  return "dm";
}

/**
 * True when inbound interactivity is wired — i.e. the signing secret is set, so
 * the "Accept from Slack" button on goal-change messages can be verified and
 * acted on. The secret itself is never exposed.
 */
export function slackInteractiveConfigured(): boolean {
  return !!config.slackSigningSecret;
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
 * An optional action button rendered under a Slack message. `value` is echoed
 * back verbatim in the interaction payload, so it carries whatever the
 * inbound handler needs (e.g. a goal-change-request id).
 */
export interface SlackButton {
  text: string;
  actionId: string;
  value: string;
  /** Slack button style — "primary" (green) for the Accept action. */
  style?: "primary" | "danger";
}

/**
 * POST to the configured Slack Incoming Webhook. Accepts either plain text or
 * a full Block Kit payload (for interactive buttons). Fire-and-forget and
 * fully guarded — a Slack outage must never break (or slow) an in-app
 * notification. Returns true only on a 2xx.
 */
export async function postToSlack(text: string, blocks?: unknown[]): Promise<boolean> {
  if (!config.slackWebhookUrl) return false;
  try {
    // `text` is always sent as the notification/fallback string even when
    // blocks are present, so mobile push previews and a11y still read well.
    const payload = blocks ? { text, blocks } : { text };
    const res = await fetch(config.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Block Kit for a message with an optional single action button. */
function messageBlocks(title: string, body: string, button?: SlackButton): unknown[] {
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${title}*\n${body}` } },
  ];
  if (button) {
    blocks.push({
      type: "actions",
      // block_id echoes back too — the interaction handler reads action_id.
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: button.text, emoji: true },
          action_id: button.actionId,
          value: button.value,
          ...(button.style ? { style: button.style } : {}),
        },
      ],
    });
  }
  return blocks;
}

/** Slack Web API call (bot token). Guarded; returns the parsed JSON or null. */
async function slackApi<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  if (!config.slackBotToken) return null;
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.slackBotToken}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Resolve a person's work email to their Slack user id (needs users:read.email). Null if not found. */
async function lookupSlackUserId(email: string): Promise<string | null> {
  const res = await slackApi<{ ok: boolean; user?: { id?: string } }>("users.lookupByEmail", { email });
  return res?.ok && res.user?.id ? res.user.id : null;
}

/** DM a person by email (needs chat:write). Renders the interactive block when a button is given. Returns true on success. */
export async function dmPerson(email: string, title: string, body: string, button?: SlackButton): Promise<boolean> {
  const userId = await lookupSlackUserId(email);
  if (!userId) return false;
  const payload: Record<string, unknown> = { channel: userId, text: formatSlackMessage(title, body) };
  if (button) payload.blocks = messageBlocks(title, body, button);
  const res = await slackApi<{ ok: boolean }>("chat.postMessage", payload);
  return !!res?.ok;
}

/**
 * Post a team message to the shared channel (webhook), gated by the master
 * switch + this event's toggle. Used for broadcasts in DM mode (once per
 * round), so "up for grabs" reaches the channel rather than DMing everyone.
 */
export async function notifyChannel(type: string, title: string, body: string): Promise<void> {
  if (!slackConfigured()) return;
  try {
    const settings = await getNotificationSettings();
    if (!slackEventEnabled(settings, type)) return;
    await postToSlack(formatSlackMessage(title, body));
  } catch {
    // never let Slack delivery affect the in-app path
  }
}

/**
 * Called from notify() for every notification. Gated by the master switch +
 * the per-event toggle. Routing (see slackRouteFor): with a bot token, personal
 * events DM the recipient (looked up by email) and team events are left to the
 * broadcast path; without a bot token, everything posts to the channel webhook.
 * Interactive buttons only render when a signing secret is set. Never throws.
 */
export async function maybeNotifySlack(
  personId: string,
  type: string,
  title: string,
  body: string,
  button?: SlackButton
): Promise<void> {
  try {
    const settings = await getNotificationSettings();
    if (!slackEventEnabled(settings, type)) return;
    const withButton = button && config.slackSigningSecret ? button : undefined;
    const route = slackRouteFor(type, slackDmConfigured());
    if (route === "skip") return;
    if (route === "dm") {
      const person = await findPersonById(personId);
      if (!person?.email) return;
      await dmPerson(person.email, title, body, withButton);
      return;
    }
    // channel (legacy webhook mode)
    if (!slackConfigured()) return;
    await postToSlack(formatSlackMessage(title, body), withButton ? messageBlocks(title, body, withButton) : undefined);
  } catch {
    // never let Slack delivery affect the in-app notification path
  }
}

/**
 * One representative sample per notification type — dummy data — for the owner
 * "Send a sample of each event" preview. Bypasses the per-event toggles on
 * purpose (it's a manual preview of every message the team could receive).
 */
const SAMPLE_NOTIFICATIONS: { title: string; body: string; button?: SlackButton }[] = [
  { title: "New project assigned to you", body: "Nadia Karim has staffed you on a new project with a goal of 3." },
  { title: "Team member staffed on another team's project", body: "Omar Rashid has been staffed by Nadia Karim from Team Industrial Scale with a goal of 4." },
  { title: "Seat claimed from the broadcast", body: "Client_Helios — Sell-side just got a new deliverer from the broadcast." },
  {
    title: "Goal change requested",
    body: "Omar Rashid has requested a goal change on Project Client_Helios: Goal of 2 Status Second Deliverable. Explanation: pool is thin.",
    button: { text: "✓ Accept", actionId: "accept_goal_change", value: "sample", style: "primary" },
  },
  { title: "Goal change still needs action", body: "Omar Rashid requested a goal change to Nadia Karim's project Client_Helios that has not been actioned on." },
  { title: "Your goal change request was accepted", body: "Client_Helios: your goal change request was accepted — goal 2, status Second Deliverable." },
  { title: "Delivery logged — review", body: "Omar Rashid logged progress on Client_Helios: 4/8." },
  { title: "First Deliverable due", body: "Client_Helios has been in First Deliverable 2+ hours with no progress logged." },
  { title: "Project up for grabs", body: "Client_Helios has no one staffed — everyone's busy on fresh projects. First to accept takes a seat." },
  { title: "A project was transferred to you", body: "Client_Helios — Buy-side diligence is now yours to lead." },
];

/**
 * Post an intro header plus one sample of every notification type to the
 * configured channel. Owner-triggered preview; ignores the per-event toggles.
 * Returns how many messages were accepted (2xx). Never throws.
 */
export async function postSampleNotifications(sentBy: string): Promise<number> {
  if (!slackConfigured()) return 0;
  let sent = 0;
  const intro = await postToSlack(
    formatSlackMessage(
      "🧪 CapTracker — sample notifications (preview)",
      `The next messages show each alert type CapTracker can post here. These are examples, not real events. Sent by ${sentBy}.`
    )
  );
  if (intro) sent += 1;
  for (const s of SAMPLE_NOTIFICATIONS) {
    const withButton = s.button && config.slackSigningSecret ? s.button : undefined;
    const ok = await postToSlack(
      formatSlackMessage(s.title, s.body),
      withButton ? messageBlocks(s.title, s.body, withButton) : undefined
    );
    if (ok) sent += 1;
  }
  return sent;
}
