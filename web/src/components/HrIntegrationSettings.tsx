import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { HrIntegrationSettings as HR } from "../api/types";
import { useApp } from "../state/AppContext";

function Toggle({ on, disabled, onClick }: { on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button className={"sw " + (on ? "on" : "")} disabled={disabled} onClick={onClick} aria-pressed={on}>
      <span />
    </button>
  );
}

/**
 * Settings → Integrations → BambooHR. Owner-editable leave sync: when someone
 * is on a matching leave type (vacation/sick) in BambooHR, CapTracker sets them
 * "On vacation", and restores them to Available when the leave ends. The API
 * credentials live on the server (env) and are shown here only as a read-only
 * "Configured / Not configured" status — the key is never sent to the client.
 */
export default function HrIntegrationSettings({ onSaved }: { onSaved: () => void }) {
  const { actor } = useApp();
  const readOnly = !actor.isOwner;
  const [draft, setDraft] = useState<HR | null>(null);
  const [saved, setSaved] = useState<HR | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Credential inputs — write-only. apiKeyInput is never pre-filled.
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [subdomainInput, setSubdomainInput] = useState("");

  const load = () => api.get<HR>("/settings/hr-integration").then((s) => { setDraft(s); setSaved(s); setSubdomainInput(s.subdomain ?? ""); });
  useEffect(() => { load(); }, []);

  const saveCredentials = async (clear = false) => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const body: Record<string, unknown> = {};
      if (clear) body.clearApiKey = true;
      else if (apiKeyInput.trim()) body.apiKey = apiKeyInput.trim();
      if (subdomainInput.trim()) body.subdomain = subdomainInput.trim();
      const updated = await api.patch<HR>("/settings/hr-integration", body);
      setDraft(updated); setSaved(updated); setApiKeyInput(""); setSubdomainInput(updated.subdomain ?? "");
      setMsg(clear ? "Key cleared." : "Credentials saved (encrypted).");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save credentials");
    } finally { setBusy(false); }
  };

  if (!draft || !saved) return <div className="empty">Loading…</div>;

  const dirty = draft.enabled !== saved.enabled || draft.leaveTypeKeywords !== saved.leaveTypeKeywords;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const updated = await api.patch<HR>("/settings/hr-integration", {
        enabled: draft.enabled,
        leaveTypeKeywords: draft.leaveTypeKeywords,
      });
      setDraft(updated); setSaved(updated); setOk(true); onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally { setBusy(false); }
  };

  const testConnection = async () => {
    setBusy(true); setMsg(null); setError(null);
    try {
      const res = await api.post<{ ok: boolean; employees: number }>("/settings/hr-integration/test");
      setMsg(res.ok ? `Connected ✓ — ${res.employees} employees in the directory.` : "BambooHR rejected the request — check the API key and subdomain.");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not reach BambooHR");
    } finally { setBusy(false); }
  };

  const syncNow = async () => {
    setBusy(true); setMsg(null); setError(null);
    try {
      const res = await api.post<{ summary: string }>("/settings/hr-integration/sync");
      setMsg(res.summary);
      await load();
      onSaved();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Sync failed");
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="scope-note">
        {readOnly
          ? "BambooHR leave sync — read-only (owners manage this)."
          : "Sync BambooHR leave into CapTracker: anyone on a matching leave type is set to “On vacation”, and restored to Available when they’re back."}
      </div>

      <div className="card cs-card">
        <div className="cs-head">BambooHR</div>
        <div className="cs-row">
          <div>
            <div className="cs-rl">Connection</div>
            <div className="cs-rs">
              {draft.hasKey ? <>Key stored (ends <code>••••{draft.hint}</code>), encrypted via <strong>{draft.secretStore === "kms" ? "Google Cloud KMS" : "local key"}</strong>.</> : "No key stored yet — paste one below."}
              {draft.secretStore === "local" && <> <span style={{ color: "var(--amber, #a5770b)" }}>⚠ dev encryption — set <code>KMS_KEY_NAME</code> on the server for KMS.</span></>}
            </div>
          </div>
          <div className="cs-controls">
            {draft.configured ? <span className="mini free">Configured</span> : <span className="mini off">Not configured</span>}
          </div>
        </div>
        {!readOnly && (
          <div className="cs-row">
            <div>
              <div className="cs-rl">BambooHR credentials</div>
              <div className="cs-rs">The API key is encrypted before it's stored and is never shown again — only the last 4 digits. Subdomain is the <code>&lt;x&gt;</code> in <code>https://&lt;x&gt;.bamboohr.com</code>.</div>
            </div>
            <div className="cs-controls" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, minWidth: 240 }}>
              <input className="cs-time" value={subdomainInput} disabled={busy} onChange={(e) => setSubdomainInput(e.target.value)} placeholder="subdomain (e.g. alphasights)" />
              <input className="cs-time" type="password" autoComplete="off" value={apiKeyInput} disabled={busy} onChange={(e) => setApiKeyInput(e.target.value)} placeholder={draft.hasKey ? "•••• enter a new key to replace" : "paste API key"} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-pl" disabled={busy || (!apiKeyInput.trim() && subdomainInput.trim() === (saved.subdomain ?? ""))} onClick={() => saveCredentials(false)}>Save credentials</button>
                {draft.hasKey && <button className="btn btn-ghost" disabled={busy} onClick={() => saveCredentials(true)}>Clear key</button>}
              </div>
            </div>
          </div>
        )}
        <div className="cs-row">
          <div>
            <div className="cs-rl">Sync leave → On vacation</div>
            <div className="cs-rs">Master switch. When on, the sync runs automatically (about every 30 min) and can be run on demand below.</div>
          </div>
          <div className="cs-controls">
            <Toggle on={draft.enabled} disabled={readOnly} onClick={() => { setDraft({ ...draft, enabled: !draft.enabled }); setOk(false); }} />
          </div>
        </div>
        <div className="cs-row">
          <div>
            <div className="cs-rl">Leave types to match</div>
            <div className="cs-rs">Comma-separated. Matched case-insensitively against BambooHR time-off type names (substring). e.g. <code>vacation, sick</code>.</div>
          </div>
          <div className="cs-controls">
            <input
              className="cs-time"
              value={draft.leaveTypeKeywords}
              disabled={readOnly}
              onChange={(e) => { setDraft({ ...draft, leaveTypeKeywords: e.target.value }); setOk(false); }}
              placeholder="vacation, sick"
              style={{ minWidth: 160 }}
            />
          </div>
        </div>
        <div className="cs-row">
          <div>
            <div className="cs-rl">Last sync</div>
            <div className="cs-rs">{draft.lastSyncAt ? `${new Date(draft.lastSyncAt).toLocaleString()} — ${draft.lastSyncSummary ?? ""}` : "Never run."}</div>
          </div>
          <div className="cs-controls" style={{ gap: 8 }}>
            {!readOnly && draft.configured && (
              <>
                <button className="btn btn-ghost" disabled={busy} onClick={testConnection}>Test</button>
                <button className="btn btn-ghost" disabled={busy || !draft.enabled} onClick={syncNow}>Sync now</button>
              </>
            )}
          </div>
        </div>
        {msg && <div className="cs-rs" style={{ marginTop: 6 }}>{msg}</div>}
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
