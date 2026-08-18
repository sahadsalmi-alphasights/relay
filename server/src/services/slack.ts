import { config } from "../config";
import { getNotificationSettings, type NotificationSettings } from "../repositories/notificationSettings";
import { findPersonById } from "../repositories/people";
import { GOAL_CHANGE_TARGETS, goalChangeTargetLabel } from "../rules/goalChange";
import { getSecret } from "./secretsVault";

/** Vault secret names for the Slack credentials. */
export const SLACK_SECRET = {
  webhookUrl: "slack.webhook_url",
  signingSecret: "slack.signing_secret",
  botToken: "slack.bot_token",
} as const;

/**
 * Resolve each Slack credential: the value pasted in Integrations (decrypted
 * via the vault) takes precedence, falling back to the env var so existing
 * deployments keep working. Errors (e.g. KMS) resolve to null (treated as
 * "not configured") — a Slack blip must never break the app.
 */
async function resolveSecret(name: string, envFallback: string): Promise<string> {
  try {
    const stored = await getSecret(name);
    if (stored) return stored;
  } catch {
    /* fall through to env */
  }
  return envFallback;
}
export const getSlackWebhookUrl = () => resolveSecret(SLACK_SECRET.webhookUrl, config.slackWebhookUrl);
export const getSlackSigningSecret = () => resolveSecret(SLACK_SECRET.signingSecret, config.slackSigningSecret);
export const getSlackBotToken = () => resolveSecret(SLACK_SECRET.botToken, config.slackBotToken);

/** True when a Slack webhook is configured (stored or env). The URL is never exposed. */
export async function slackConfigured(): Promise<boolean> {
  return !!(await getSlackWebhookUrl());
}

/** True when a bot token is configured — enables per-person DMs. The token is never exposed. */
export async function slackDmConfigured(): Promise<boolean> {
  return !!(await getSlackBotToken());
}

/**
 * Owner diagnostics for the bot token: calls Slack `auth.test`, surfacing the
 * real reason (invalid_auth, not_authed, network) the normal path swallows.
 * Also reports whether the token has the scopes DMs need can only be inferred
 * on actual use, so this just proves the token authenticates.
 */
export async function diagnoseBotToken(): Promise<{ ok: boolean; team?: string; botId?: string; error?: string }> {
  const token = await getSlackBotToken();
  if (!token) return { ok: false, error: "No bot token set (paste one in Integrations)." };
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    const j = (await res.json()) as { ok: boolean; error?: string; team?: string; user_id?: string };
    if (!j.ok) return { ok: false, error: j.error ?? "auth_failed" };
    return { ok: true, team: j.team, botId: j.user_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error reaching Slack" };
  }
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
export async function slackInteractiveConfigured(): Promise<boolean> {
  return !!(await getSlackSigningSecret());
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
export async function postToSlack(text: string, attachments?: unknown[]): Promise<boolean> {
  const webhookUrl = await getSlackWebhookUrl();
  if (!webhookUrl) return false;
  try {
    // `text` is always sent as the notification/fallback string even when
    // attachments are present, so mobile push previews and a11y still read well.
    const payload = attachments ? { text, attachments } : { text };
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Per-notification-type visual identity: a leading emoji for the header and a
 * severity color for the attachment's left bar. Green = informational, amber =
 * needs attention, red = urgent, blue/orange = team/broadcast. Unknown types
 * fall back to a neutral bell.
 */
const TYPE_META: Record<string, { emoji: string; color: string }> = {
  assigned: { emoji: "✅", color: "#2eb67d" },
  goal_change_requested: { emoji: "🎯", color: "#ecb22e" },
  goal_change_resolved: { emoji: "🤝", color: "#2eb67d" },
  delivery_logged: { emoji: "📦", color: "#36c5f0" },
  stale_first_deliverable: { emoji: "⏱️", color: "#e01e5a" },
  project_transferred: { emoji: "🔁", color: "#2f6fed" },
  open_pool: { emoji: "📣", color: "#e8912d" },
};
const DEFAULT_META = { emoji: "🔔", color: "#616061" };

/**
 * Build the rich Slack message as a single colored attachment:
 *  - a `header` block (large title, prefixed with the type's emoji),
 *  - a `section` with the body copy,
 *  - an optional `actions` row of buttons,
 *  - a `context` footer with the CapTracker badge + a Slack-native relative time.
 * The attachment's `color` draws the severity bar down the left edge.
 * `nowMs` is injectable so tests get a deterministic timestamp.
 */
export function messageAttachments(
  type: string | undefined,
  title: string,
  body: string,
  buttons?: SlackButton[],
  nowMs: number = Date.now()
): unknown[] {
  const meta = (type && TYPE_META[type]) || DEFAULT_META;
  const blocks: unknown[] = [
    // Header is plain_text only and capped at 150 chars by Slack.
    { type: "header", text: { type: "plain_text", text: `${meta.emoji} ${title}`.slice(0, 150), emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: body } },
  ];
  if (buttons && buttons.length) {
    blocks.push({
      type: "actions",
      elements: buttons.map((b) => ({
        type: "button",
        text: { type: "plain_text", text: b.text, emoji: true },
        action_id: b.actionId,
        value: b.value,
        ...(b.style ? { style: b.style } : {}),
      })),
    });
  }
  const ts = Math.floor(nowMs / 1000);
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `📊 *CapTracker*  ·  <!date^${ts}^{time}|just now>` }],
  });
  return [{ color: meta.color, blocks }];
}

/** Slack Web API call (bot token). Guarded; returns the parsed JSON or null. */
async function slackApi<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const botToken = await getSlackBotToken();
  if (!botToken) return null;
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** GET-style Slack Web API call (for methods that take query params, e.g. users.lookupByEmail). */
async function slackGet<T>(pathWithQuery: string): Promise<T | null> {
  const botToken = await getSlackBotToken();
  if (!botToken) return null;
  try {
    const res = await fetch(`https://slack.com/api/${pathWithQuery}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * DM a person by email (needs users:read.email to look them up + chat:write to
 * message). Renders the interactive block when a button is given. Returns ok,
 * plus Slack's error string on failure (e.g. missing_scope, users_not_found,
 * channel_not_found) so callers can surface a precise reason.
 */
export async function dmPerson(
  email: string,
  type: string | undefined,
  title: string,
  body: string,
  buttons?: SlackButton[]
): Promise<{ ok: boolean; error?: string }> {
  // users.lookupByEmail takes the email as a query param, NOT a JSON body —
  // posting JSON makes Slack see no `email` and return invalid_arguments.
  const look = await slackGet<{ ok: boolean; error?: string; user?: { id?: string } }>(
    `users.lookupByEmail?email=${encodeURIComponent(email)}`
  );
  if (!look) return { ok: false, error: "lookup:no_response" };
  if (!look.ok || !look.user?.id) return { ok: false, error: `lookup:${look.error ?? "user_not_found"}` };
  // `text` is always the fallback/preview string; the rich card rides in attachments.
  const payload: Record<string, unknown> = {
    channel: look.user.id,
    text: `${title}\n${body}`,
    attachments: messageAttachments(type, title, body, buttons),
  };
  const post = await slackApi<{ ok: boolean; error?: string }>("chat.postMessage", payload);
  if (!post) return { ok: false, error: "post:no_response" };
  return post.ok ? { ok: true } : { ok: false, error: `post:${post.error ?? "post_failed"}` };
}

/**
 * Post a team message to the shared channel (webhook), gated by the master
 * switch + this event's toggle. Used for broadcasts in DM mode (once per
 * round), so "up for grabs" reaches the channel rather than DMing everyone.
 */
export async function notifyChannel(type: string, title: string, body: string): Promise<void> {
  if (!(await slackConfigured())) return;
  try {
    const settings = await getNotificationSettings();
    if (!slackEventEnabled(settings, type)) return;
    await postToSlack(formatSlackMessage(title, body), messageAttachments(type, title, body));
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
  buttons?: SlackButton[]
): Promise<void> {
  try {
    const settings = await getNotificationSettings();
    if (!slackEventEnabled(settings, type)) return;
    // Interactive buttons only work when a signing secret is set to verify the callback.
    const withButtons = buttons && (await getSlackSigningSecret()) ? buttons : undefined;
    const route = slackRouteFor(type, await slackDmConfigured());
    if (route === "skip") return;
    if (route === "dm") {
      const person = await findPersonById(personId);
      if (!person?.email) return;
      await dmPerson(person.email, type, title, body, withButtons);
      return;
    }
    // channel (legacy webhook mode)
    if (!(await slackConfigured())) return;
    await postToSlack(formatSlackMessage(title, body), messageAttachments(type, title, body, withButtons));
  } catch {
    // never let Slack delivery affect the in-app notification path
  }
}

/**
 * One representative sample per notification type — dummy data — for the owner
 * "Send a sample of each event" preview. Bypasses the per-event toggles on
 * purpose (it's a manual preview of every message the team could receive).
 */
interface SampleMsg { type: string; title: string; body: string; buttons?: SlackButton[] }

/**
 * The Accept / Amend / Decline buttons for a goal-change request Slack message.
 * `value` carries the request id so /slack/interactive can act on it.
 */
export function goalChangeButtons(gcrId: string): SlackButton[] {
  return [
    { text: "✓ Accept", actionId: "accept_goal_change", value: gcrId, style: "primary" },
    { text: "✎ Amend", actionId: "amend_goal_change", value: gcrId },
    { text: "✕ Decline", actionId: "decline_goal_change", value: gcrId, style: "danger" },
  ];
}

/**
 * One representative sample per per-event toggle (key = the NotificationSettings
 * boolean). Dummy data. Used both for the channel "sample of each event" preview
 * and the per-alert "DM me a test" buttons.
 */
const SAMPLES: { key: string; sample: SampleMsg }[] = [
  { key: "slackAssigned", sample: { type: "assigned", title: "New project assigned to you", body: "Nadia Karim has staffed you on a new project with a goal of 3." } },
  {
    key: "slackGoalChangeRequested",
    sample: {
      type: "goal_change_requested",
      title: "Goal change requested",
      body: "Omar Rashid has requested a goal change on Project Client_Helios: Goal of 2 Status Second Deliverable. Explanation: pool is thin.",
      buttons: goalChangeButtons("sample"),
    },
  },
  { key: "slackGoalChangeResolved", sample: { type: "goal_change_resolved", title: "Your goal change request was accepted", body: "Client_Helios: your goal change request was accepted — goal 2, status Second Deliverable." } },
  { key: "slackDeliveryLogged", sample: { type: "delivery_logged", title: "Delivery logged — review", body: "Omar Rashid logged progress on Client_Helios: 4/8." } },
  { key: "slackStaleFirstDeliverable", sample: { type: "stale_first_deliverable", title: "First Deliverable due", body: "Client_Helios has been in First Deliverable 2+ hours with no progress logged." } },
  { key: "slackProjectTransferred", sample: { type: "project_transferred", title: "A project was transferred to you", body: "Client_Helios — Buy-side diligence is now yours to lead." } },
  { key: "slackBroadcastUpForGrabs", sample: { type: "open_pool", title: "Project up for grabs", body: "Client_Helios has no one staffed — everyone's busy on fresh projects. First to accept takes a seat." } },
];

/** The valid sample keys, for request validation. */
export const SAMPLE_EVENT_KEYS = SAMPLES.map((s) => s.key);

/**
 * Post an intro header plus one sample of every alert type to the configured
 * channel. Owner-triggered preview; ignores the per-event toggles. Returns how
 * many messages were accepted (2xx). Never throws.
 */
export async function postSampleNotifications(sentBy: string): Promise<number> {
  if (!(await slackConfigured())) return 0;
  const signingSecret = await getSlackSigningSecret();
  let sent = 0;
  const intro = await postToSlack(
    formatSlackMessage(
      "🧪 CapTracker — sample notifications (preview)",
      `The next messages show each alert type CapTracker can post here. These are examples, not real events. Sent by ${sentBy}.`
    )
  );
  if (intro) sent += 1;
  for (const { sample } of SAMPLES) {
    const withButtons = sample.buttons && signingSecret ? sample.buttons : undefined;
    const ok = await postToSlack(
      formatSlackMessage(sample.title, sample.body),
      messageAttachments(sample.type, sample.title, sample.body, withButtons)
    );
    if (ok) sent += 1;
  }
  return sent;
}

/**
 * DM a sample to one person — either a single alert type (by key) or all of
 * them. Used by the "DM me a test" buttons so an owner previews exactly what an
 * individual receives. Requires a bot token. Returns how many DMs were sent.
 */
export async function dmSampleToPerson(email: string, eventKey?: string): Promise<{ sent: number; error?: string }> {
  if (!(await slackDmConfigured())) return { sent: 0, error: "not_configured" };
  const signingSecret = await getSlackSigningSecret();
  const chosen = eventKey ? SAMPLES.filter((s) => s.key === eventKey) : SAMPLES;
  let sent = 0;
  let error: string | undefined;
  for (const { sample } of chosen) {
    const withButtons = sample.buttons && signingSecret ? sample.buttons : undefined;
    const r = await dmPerson(email, sample.type, `[Test] ${sample.title}`, sample.body, withButtons);
    if (r.ok) sent += 1;
    else if (!error) error = r.error;
  }
  return { sent, error };
}

/** Slack modal callback_id for the goal-change Amend flow. */
export const AMEND_CALLBACK_ID = "amend_goal_change";

/**
 * Open the "Amend goal change" modal (views.open) prefilled with the requested
 * goal + stage, so a PL can tweak either and accept-with-changes from Slack.
 * private_metadata carries the request id. Needs the bot token + a trigger_id
 * from the button click. Returns false if Slack rejects it.
 */
export async function openGoalChangeAmendModal(
  triggerId: string,
  gcrId: string,
  requestedGoal: number | null,
  requestedStatus: string | null
): Promise<boolean> {
  const options = GOAL_CHANGE_TARGETS.map((t) => ({
    text: { type: "plain_text", text: goalChangeTargetLabel(t) },
    value: t,
  }));
  const initialStatus = GOAL_CHANGE_TARGETS.includes((requestedStatus ?? "") as (typeof GOAL_CHANGE_TARGETS)[number])
    ? requestedStatus
    : undefined;
  const view = {
    type: "modal",
    callback_id: AMEND_CALLBACK_ID,
    private_metadata: gcrId,
    title: { type: "plain_text", text: "Amend goal change" },
    submit: { type: "plain_text", text: "Accept with changes" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "goal",
        label: { type: "plain_text", text: "Goal" },
        element: {
          type: "number_input",
          is_decimal_allowed: false,
          action_id: "goal",
          initial_value: String(requestedGoal ?? 1),
          min_value: "0",
        },
      },
      {
        type: "input",
        block_id: "status",
        label: { type: "plain_text", text: "Stage" },
        element: {
          type: "static_select",
          action_id: "status",
          options,
          ...(initialStatus
            ? { initial_option: { text: { type: "plain_text", text: goalChangeTargetLabel(initialStatus) }, value: initialStatus } }
            : {}),
        },
      },
    ],
  };
  const res = await slackApi<{ ok: boolean; error?: string }>("views.open", { trigger_id: triggerId, view });
  return !!res?.ok;
}
