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
 * Offline, and restores them to Available when the leave ends. The API
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

  const load = () => api.get<HR>("/settings/hr-integration").then((s) => { setDraft(s); setSaved(s); });
  useEffect(() => { load(); }, []);

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
          : "Sync BambooHR leave into CapTracker: anyone on a matching leave type is set Offline, and restored to Available when they're back."}
      </div>

      <div className="card cs-card">
        <div className="cs-head">BambooHR</div>
        <div className="cs-row">
          <div>
            <div className="cs-rl">Connection</div>
            <div className="cs-rs">The API key + subdomain are set on the server (never shown here). Ask an admin to set <code>BAMBOOHR_API_KEY</code> and <code>BAMBOOHR_SUBDOMAIN</code> if this says Not configured.</div>
          </div>
          <div className="cs-controls">
            {draft.configured ? <span className="mini free">Configured</span> : <span className="mini off">Not configured</span>}
          </div>
        </div>
        <div className="cs-row">
          <div>
            <div className="cs-rl">Sync leave → Offline</div>
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
