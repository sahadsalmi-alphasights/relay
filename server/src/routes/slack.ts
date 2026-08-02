import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { config } from "../config";
import { findAssignmentById } from "../repositories/assignments";
import { findGoalChangeRequestById } from "../repositories/goalChangeRequests";
import { findProjectById } from "../repositories/projects";
import { applyAndResolveGoalChange } from "../services/goalChangeResolve";

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
      actions?: { action_id?: string; value?: string }[];
    };
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      return reply.code(400).send({ error: "bad_payload" });
    }

    const action = payload.actions?.[0];
    if (payload.type !== "block_actions" || action?.action_id !== "accept_goal_change" || !action.value) {
      // Nothing we handle — ack so Slack doesn't retry.
      return reply.code(200).send();
    }

    const gcrId = action.value;
    const gcr = await findGoalChangeRequestById(gcrId);
    if (!gcr) {
      if (payload.response_url) await replaceMessage(payload.response_url, "This goal change request no longer exists.");
      return reply.code(200).send();
    }
    const assignment = await findAssignmentById(gcr.assignmentId);
    const project = assignment ? await findProjectById(assignment.projectId) : null;
    // Attribute the accept to the PL whose channel approved it.
    const actorId = project?.plId ?? gcr.requestedBy;

    const result = await applyAndResolveGoalChange(gcrId, actorId, { outcome: "accepted" }, "slack");
    if (payload.response_url) {
      const msg = result
        ? gcr.resolved
          ? `Already resolved — ${result.client}.`
          : `✓ Accepted from Slack — ${result.client}: goal change applied.`
        : "Couldn't apply that goal change.";
      await replaceMessage(payload.response_url, msg);
    }
    return reply.code(200).send();
  });
};

export default slackRoutes;
