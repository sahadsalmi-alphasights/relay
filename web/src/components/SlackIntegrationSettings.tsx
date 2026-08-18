import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useApp } from "../state/AppContext";

interface Hint { hasValue: boolean; hint: string | null }
interface SlackState {
  slackConfigured: boolean;
  slackInteractiveConfigured: boolean;
  slackDmConfigured: boolean;
  slackSecretStore?: "kms" | "local";
  slackHints?: { webhookUrl: Hint; signingSecret: Hint; botToken: Hint };
}

const FIELDS = [
  { key: "webhookUrl", label: "Incoming webhook URL", hint: "Posts to the shared channel. From Slack → Incoming Webhooks.", enables: "channel messages" },
  { key: "botToken", label: "Bot token (xoxb-…)", hint: "Enables per-person DMs. Needs scopes chat:write + users:read.email.", enables: "per-person DMs" },
  { key: "signingSecret", label: "Signing secret", hint: "Verifies inbound button clicks (Accept / Amend / Decline).", enables: "interactive buttons" },
] as const;

/**
 * Settings → Integrations → Slack. Owners paste the three Slack credentials
 * here; each is encrypted at rest (GCP KMS in prod) and never returned — only a
 * "•••• last4" hint. Env vars remain a fallback.
 */
export default function SlackIntegrationSettings({ onSaved }: { onSaved: () => void }) {
  const { actor } = useApp();
  const readOnly = !actor.isOwner;
  const [s, setS] = useState<SlackState | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({ webhookUrl: "", signingSecret: "", botToken: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.get<SlackState>("/settings/notifications").then(setS);
  useEffect(() => { load(); }, []);
  if (!s) return null;

  const saveOne = async (key: string) => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const updated = await api.patch<SlackState>("/settings/notifications/slack-credentials", { [key]: inputs[key].trim() });
      setS(updated); setInputs((p) => ({ ...p, [key]: "" })); setMsg("Saved (encrypted)."); onSaved();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not save"); }
    finally { setBusy(false); }
  };
  const clearOne = async (key: string) => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const updated = await api.patch<SlackState>("/settings/notifications/slack-credentials", { clear: key });
      setS(updated); setMsg("Cleared."); onSaved();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not clear"); }
    finally { setBusy(false); }
  };
  const testConnection = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await api.post<{ ok: boolean }>("/settings/notifications/test");
      setMsg(res.ok ? "Test message sent ✓ — check the Slack channel." : "Slack rejected the webhook — check the URL.");
    } catch (err) { setMsg(err instanceof ApiError ? err.message : "Could not reach Slack"); }
    finally { setBusy(false); }
  };

  const hintFor = (k: string) => s.slackHints?.[k as keyof NonNullable<SlackState["slackHints"]>];

  return (
    <div className="card cs-card">
      <div className="cs-head">Slack</div>
      <div className="cs-row">
        <div>
          <div className="cs-rl">Status</div>
          <div className="cs-rs">
            Channel: {s.slackConfigured ? "on" : "off"} · DMs: {s.slackDmConfigured ? "on" : "off"} · Buttons: {s.slackInteractiveConfigured ? "on" : "off"}.
            {s.slackSecretStore === "local" && <> <span style={{ color: "var(--amber, #a5770b)" }}>⚠ dev encryption — set <code>KMS_KEY_NAME</code> for KMS.</span></>}
          </div>
        </div>
        <div className="cs-controls">
          {s.slackConfigured ? <span className="mini free">Configured</span> : <span className="mini off">Not configured</span>}
        </div>
      </div>

      {!readOnly && FIELDS.map((f) => {
        const h = hintFor(f.key);
        return (
          <div className="cs-row" key={f.key}>
            <div>
              <div className="cs-rl">{f.label} {h?.hasValue && <span className="mini free">set ••••{h.hint}</span>}</div>
              <div className="cs-rs">{f.hint} <em>Enables {f.enables}.</em></div>
            </div>
            <div className="cs-controls" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, minWidth: 240 }}>
              <input className="cs-time" type="password" autoComplete="off" value={inputs[f.key]} disabled={busy}
                placeholder={h?.hasValue ? "•••• enter new to replace" : "paste value"}
                onChange={(e) => setInputs((p) => ({ ...p, [f.key]: e.target.value }))} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-pl" disabled={busy || !inputs[f.key].trim()} onClick={() => saveOne(f.key)}>Save</button>
                {h?.hasValue && <button className="btn btn-ghost" disabled={busy} onClick={() => clearOne(f.key)}>Clear</button>}
              </div>
            </div>
          </div>
        );
      })}

      {!readOnly && (
        <div className="cs-row">
          <div><div className="cs-rl">Test</div><div className="cs-rs">Sends a test message to the channel to confirm the webhook works.</div></div>
          <div className="cs-controls"><button className="btn btn-ghost" disabled={busy || !s.slackConfigured} onClick={testConnection}>Send test</button></div>
        </div>
      )}
      {msg && <div className="cs-rs" style={{ marginTop: 6 }}>{msg}</div>}
      {error && <div className="err-line">{error}</div>}
    </div>
  );
}
