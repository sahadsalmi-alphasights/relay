import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { config } from "../config";
import { findAssignmentById } from "../repositories/assignments";
import { findGoalChangeRequestById } from "../repositories/goalChangeRequests";
import { findProjectById } from "../repositories/projects";
import { applyAndResolveGoalChange } from "../services/goalChangeResolve";
import { AMEND_CALLBACK_ID, openGoalChangeAmendModal } from "../services/slack";
import type { GoalChangeRequestRow } from "../repositories/goalChangeRequests";

/**
 * Inbound Slack interactivity — the callback for the Accept button on a
 * goal-change Slack message. This is the ONE endpoint that trusts a request
 * without an app session: it authenticates via Slack's request signature
 * (HMAC-SHA256 over `v0:{timestamp}:{rawBody}` with the app Signing Secret),
 * exactly as Slack documents. No signing secret configured ⇒ the endpoint
 * rejects everything, so the button simply does nothing rather than exposing
 * an unauthenticated mutation.
 *
 * Deploy note: this path must be reachable by Slack, i.e. excluded from
 * Cloudflare Access (a public hostname / Access bypass for /slack/*). The
 * signature check is what secures it, not the network layer.
 */
const SLACK_REPLAY_WINDOW_SECONDS = 60 * 5;

function verifySignature(rawBody: string, timestamp: string | undefined, signature: string | undefined): boolean {
  if (!config.slackSigningSecret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  // Reject stale/replayed requests.
  if (Math.abs(Date.now() / 1000 - ts) > SLACK_REPLAY_WINDOW_SECONDS) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = "v0=" + crypto.createHmac("sha256", config.slackSigningSecret).update(base).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Best-effort update of the original Slack message (never throws).
 *
 * Slack's response_url always lives on hooks.slack.com. The host is validated
 * inline and the fetch targets the parsed URL object, so even a forged
 * response_url can't drive an outbound request to an attacker-chosen origin
 * (defense in depth on top of the signature check — no SSRF).
 */
async function replaceMessage(responseUrl: string, text: string): Promise<void> {
  let target: URL;
  try {
    target = new URL(responseUrl);
  } catch {
    return;
  }
  if (target.protocol !== "https:" || target.hostname !== "hooks.slack.com") return;
  try {
    await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replace_original: true, text }),
    });
  } catch {
    // ignore — the in-app effect already happened
  }
}

/**
 * Whom to attribute a Slack-driven resolution to: the PL of the project the
 * request belongs to (the channel/DM that approves it), falling back to the
 * requester if the project/PL can't be resolved.
 */
async function resolveGcrActor(gcr: GoalChangeRequestRow): Promise<string> {
  const assignment = await findAssignmentById(gcr.assignmentId);
  const project = assignment ? await findProjectById(assignment.projectId) : null;
  return project?.plId ?? gcr.requestedBy;
}

const slackRoutes: FastifyPluginAsync = async (app) => {
  // Slack posts application/x-www-form-urlencoded with a single `payload`
  // field. We need the RAW body for the signature, so keep it as a string
  // (encapsulated to this plugin only — no other route is urlencoded).
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  // Explicit per-route rate limit on top of the global limiter — this endpoint
  // is public (signature-gated, no session), so bound it tightly by source IP.
  app.post("/interactive", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : "";
    const signature = request.headers["x-slack-signature"] as string | undefined;
    const timestamp = request.headers["x-slack-request-timestamp"] as string | undefined;
    if (!verifySignature(rawBody, timestamp, signature)) {
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const payloadRaw = new URLSearchParams(rawBody).get("payload");
    if (!payloadRaw) return reply.code(400).send({ error: "missing_payload" });

    let payload: {
      type?: string;
      response_url?: string;
      trigger_id?: string;
      actions?: { action_id?: string; value?: string }[];
      view?: {
        callback_id?: string;
        private_metadata?: string;
        state?: {
          values?: Record<string, Record<string, { value?: string; selected_option?: { value?: string } }>>;
        };
      };
    };
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      return reply.code(400).send({ error: "bad_payload" });
    }

    // --- Amend modal submitted ("Accept with changes" from Slack) ----------
    if (payload.type === "view_submission" && payload.view?.callback_id === AMEND_CALLBACK_ID) {
      const gcrId = payload.view.private_metadata ?? "";
      const gcr = gcrId ? await findGoalChangeRequestById(gcrId) : null;
      if (!gcr) return reply.code(200).send();
      const values = payload.view.state?.values ?? {};
      const goalRaw = values.goal?.goal?.value;
      const statusRaw = values.status?.status?.selected_option?.value;
      const goalOverride = goalRaw !== undefined && goalRaw !== "" && Number.isFinite(Number(goalRaw)) ? Number(goalRaw) : undefined;
      const statusOverride = statusRaw || undefined;
      await applyAndResolveGoalChange(
        gcrId,
        await resolveGcrActor(gcr),
        { outcome: "accepted", goalOverride, statusOverride },
        "slack"
      );
      // Empty 200 closes the modal.
      return reply.code(200).send();
    }

    const action = payload.actions?.[0];
    const actionId = action?.action_id;
    const handled = actionId === "accept_goal_change" || actionId === "decline_goal_change" || actionId === "amend_goal_change";
    if (payload.type !== "block_actions" || !handled || !action?.value) {
      // Nothing we handle — ack so Slack doesn't retry.
      return reply.code(200).send();
    }

    const gcrId = action.value;
    const gcr = await findGoalChangeRequestById(gcrId);
    if (!gcr) {
      if (payload.response_url) await replaceMessage(payload.response_url, "This goal change request no longer exists.");
      return reply.code(200).send();
    }

    // Amend just opens a prefilled modal — the actual apply happens on submit.
    if (actionId === "amend_goal_change") {
      if (gcr.resolved) {
        if (payload.response_url) await replaceMessage(payload.response_url, "This goal change request is already resolved.");
        return reply.code(200).send();
      }
      if (payload.trigger_id) {
        await openGoalChangeAmendModal(payload.trigger_id, gcrId, gcr.requestedGoal, gcr.requestedStatus);
      }
      return reply.code(200).send();
    }

    const outcome = actionId === "decline_goal_change" ? "declined" : "accepted";
    const result = await applyAndResolveGoalChange(gcrId, await resolveGcrActor(gcr), { outcome }, "slack");
    if (payload.response_url) {
      const verb = outcome === "declined" ? "Declined" : "Accepted";
      const emoji = outcome === "declined" ? "✕" : "✓";
      const msg = result
        ? gcr.resolved
          ? `Already resolved — ${result.client}.`
          : `${emoji} ${verb} from Slack — ${result.client}: goal change ${outcome === "declined" ? "declined" : "applied"}.`
        : "Couldn't apply that goal change.";
      await replaceMessage(payload.response_url, msg);
    }
    return reply.code(200).send();
  });
};

export default slackRoutes;
