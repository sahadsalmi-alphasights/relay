import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { NotificationSettings as NS } from "../api/types";
import { useApp } from "../state/AppContext";

// Per-event rows — key must match the NotificationSettings booleans.
const EVENTS: { key: keyof NS; label: string; sub: string; channel: string }[] = [
  { key: "slackBroadcastUpForGrabs", label: "Project up for grabs", sub: "A project needs staffing and went to the open pool.", channel: "Channel" },
  { key: "slackAssigned", label: "Assigned / seat claimed", sub: "You're staffed on an angle, or a seat was claimed from a broadcast.", channel: "DM" },
  { key: "slackGoalChangeRequested", label: "Goal-change requested", sub: "A deliverer asks the PL to change a goal/stage — includes an Accept button when interactive Slack is wired. Also carries Poke nudges.", channel: "DM" },
  { key: "slackGoalChangeResolved", label: "Goal-change resolved", sub: "The PL accepted or declined a request.", channel: "DM" },
  { key: "slackDeliveryLogged", label: "Delivery logged", sub: "A deliverer logged progress (can be chatty).", channel: "DM" },
  { key: "slackStaleFirstDeliverable", label: "Stalled on First Deliverable", sub: "Someone has been stuck on First Deliverable.", channel: "DM" },
  { key: "slackProjectTransferred", label: "Project transferred", sub: "A project was handed to a new PL.", channel: "DM" },
];

function Toggle({ on, disabled, onClick }: { on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button className={"sw " + (on ? "on" : "")} disabled={disabled} onClick={onClick} aria-pressed={on}>
      <span />
    </button>
  );
}

/**
 * Settings → Notifications. Owner-editable Slack routing: a master switch plus
 * per-event toggles for which CapTracker alerts also post to Slack. Whether
 * Slack is actually wired (the webhook) is a server/env concern shown here as
 * a read-only status — the URL is never exposed. Non-owners see it read-only.
 */
export default function NotificationSettings({ onSaved }: { onSaved: () => void }) {
  const { actor } = useApp();
  const readOnly = !actor.isOwner;
  const [draft, setDraft] = useState<NS | null>(null);
  const [saved, setSaved] = useState<NS | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    api.get<NS>("/settings/notifications").then((s) => { setDraft(s); setSaved(s); });
  }, []);

  if (!draft || !saved) return <div className="empty">Loading…</div>;

  const set = (k: keyof NS, v: boolean) => { setDraft({ ...draft, [k]: v }); setOk(false); };
  const dirty = (Object.keys(draft) as (keyof NS)[]).some((k) => draft[k] !== saved[k]);
  const eventsDisabled = readOnly || !draft.slackEnabled;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const { slackConfigured, slackInteractiveConfigured, slackDmConfigured, ...toggles } = draft;
      void slackConfigured;
      void slackInteractiveConfigured;
      void slackDmConfigured;
      const updated = await api.patch<NS>("/settings/notifications", toggles);
      setDraft(updated); setSaved(updated); setOk(true); onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally { setBusy(false); }
  };

  const sendTest = async () => {
    setBusy(true); setTestMsg(null); setError(null);
    try {
      const res = await api.post<{ ok: boolean }>("/settings/notifications/test");
      setTestMsg(res.ok ? "Test message sent to Slack ✓" : "Slack rejected the test — check the webhook URL.");
    } catch (err) {
      setTestMsg(err instanceof ApiError ? err.message : "Could not send test");
    } finally { setBusy(false); }
  };

  const sendSamples = async () => {
    setBusy(true); setTestMsg(null); setError(null);
    try {
      const res = await api.post<{ ok: boolean; sent: number }>("/settings/notifications/sample-all");
      setTestMsg(res.ok ? `Sent ${res.sent} sample messages to Slack ✓` : "Slack rejected the samples — check the webhook URL.");
    } catch (err) {
      setTestMsg(err instanceof ApiError ? err.message : "Could not send samples");
    } finally { setBusy(false); }
  };

  // "DM me a test" — sends a sample of one alert type (event key) or all of
  // them ("all") as a Slack DM to the current owner. Needs DM mode (bot token).
  const dmMe = async (event: string) => {
    setBusy(true); setTestMsg(null); setError(null);
    try {
      const res = await api.post<{ ok: boolean; sent: number; hint?: string }>("/settings/notifications/sample-dm", { event });
      setTestMsg(res.ok ? `DM'd ${res.sent} sample${res.sent > 1 ? "s" : ""} to you ✓ — check your Slack.` : (res.hint ?? "No DM sent."));
    } catch (err) {
      setTestMsg(err instanceof ApiError ? err.message : "Could not send DM");
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="scope-note">
        {readOnly
          ? "Which CapTracker alerts post to Slack — read-only (owners manage this)."
          : "Route CapTracker alerts into Slack. Choose the master switch and which events go through."}
      </div>

      <div className="card cs-card">
        <div className="cs-head">Slack</div>
        <div className="cs-row">
          <div>
            <div className="cs-rl">Slack connection</div>
            <div className="cs-rs">The webhook is set on the server (never shown here). Ask an admin to configure <code>SLACK_WEBHOOK_URL</code> if this says Not configured.</div>
          </div>
          <div className="cs-controls">
            {draft.slackConfigured
              ? <span className="mini free">Configured</span>
              : <span className="mini off">Not configured</span>}
          </div>
        </div>
        <div className="cs-row">
          <div>
            <div className="cs-rl">Accept from Slack (interactive)</div>
            <div className="cs-rs">The <b>Accept</b> button on a goal-change Slack message. Needs <code>SLACK_SIGNING_SECRET</code> set on the server and <code>/slack/interactive</code> reachable by Slack. Without it, the button is hidden and messages are read-only.</div>
          </div>
          <div className="cs-controls">
            {draft.slackInteractiveConfigured
              ? <span className="mini free">Configured</span>
              : <span className="mini off">Not configured</span>}
          </div>
        </div>
        <div className="cs-row">
          <div>
            <div className="cs-rl">Per-person direct messages</div>
            <div className="cs-rs">When a bot token (<code>SLACK_BOT_TOKEN</code>, needs <code>chat:write</code> + <code>users:read.email</code>) is set on the server, personal alerts DM the individual (matched by work email) and only broadcasts post to the channel. Off = everything posts to the channel.</div>
          </div>
          <div className="cs-controls">
            {draft.slackDmConfigured
              ? <span className="mini free">On — DMs enabled</span>
              : <span className="mini off">Channel-only</span>}
          </div>
        </div>
        <div className="cs-row">
          <div>
            <div className="cs-rl">Send CapTracker alerts to Slack</div>
            <div className="cs-rs">Master switch. Off = nothing posts to Slack, whatever the per-event toggles say.</div>
          </div>
          <div className="cs-controls">
            <Toggle on={draft.slackEnabled} disabled={readOnly} onClick={() => set("slackEnabled", !draft.slackEnabled)} />
          </div>
        </div>
        {!readOnly && draft.slackConfigured && (
          <div className="cs-row">
            <div>
              <div className="cs-rl">Test it</div>
              <div className="cs-rs">Post a one-off test message to the configured Slack channel.</div>
            </div>
            <div className="cs-controls" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" disabled={busy} onClick={sendTest}>Send test message</button>
              <button className="btn btn-ghost" disabled={busy} onClick={sendSamples} title="Post one example of every notification type to the channel">Send sample of each event</button>
              {draft.slackDmConfigured && (
                <button className="btn btn-ghost" disabled={busy} onClick={() => dmMe("all")} title="DM yourself a sample of every alert type">DM me all samples</button>
              )}
            </div>
          </div>
        )}
        {testMsg && <div className="cs-rs" style={{ marginTop: 6 }}>{testMsg}</div>}
      </div>

      <div className="card cs-card">
        <div className="cs-head">Which alerts go to Slack</div>
        <p className="cs-rs" style={{ margin: "0 0 8px" }}>
          Surface shows the intended target. Goal-change messages carry an interactive Accept button when "Accept from Slack" above is configured.
        </p>
        {EVENTS.map((e) => (
          <div className="cs-row" key={e.key}>
            <div>
              <div className="cs-rl">{e.label} <span className="mini team" style={{ marginLeft: 6 }}>{e.channel}</span></div>
              <div className="cs-rs">{e.sub}</div>
            </div>
            <div className="cs-controls" style={{ gap: 8 }}>
              {!readOnly && draft.slackDmConfigured && (
                <button className="btn-sm btn-ghost" disabled={busy} onClick={() => dmMe(e.key)} title="DM this alert to yourself as a test">DM me</button>
              )}
              <Toggle on={draft[e.key] as boolean} disabled={eventsDisabled} onClick={() => set(e.key, !(draft[e.key] as boolean))} />
            </div>
          </div>
        ))}
      </div>

      {error && <div className="err-line">{error}</div>}
      {!readOnly && (
        <div className="cs-actions">
          <button className="btn btn-pl" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
          <button className="btn btn-ghost" disabled={busy || !dirty} onClick={() => { setDraft(saved); setOk(false); }}>Discard</button>
          {ok && !dirty && <span className="cs-ok">✓ Saved</span>}
        </div>
      )}
    </>
  );
}
