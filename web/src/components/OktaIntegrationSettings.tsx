import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useApp } from "../state/AppContext";

interface Hint { hasValue: boolean; hint: string | null; source: "in-app" | "env" | "derived" | null }
interface OktaState {
  oktaConfigured: boolean;
  secretStore?: "kms" | "local";
  oktaHints?: { apiToken: Hint; orgUrl: Hint };
}
interface TestResult {
  ok: boolean;
  error?: string;
  users?: number;
  withTuple?: number;
  withBoard?: number;
  values?: Record<string, { value: string; count: number }[]>;
}

const sourceLabel = (s: Hint["source"]) => (s === "env" ? " · from env" : s === "derived" ? " · from OIDC issuer" : "");

/**
 * Settings → Integrations → Okta. The read-only Okta Users API token that
 * powers the instance seed (Instances → Seed from Okta). Owners paste the token
 * here; it's encrypted at rest (KMS in prod) and never returned — only a
 * "•••• last4" hint. The org URL defaults to the OIDC issuer, overridable here.
 * NOTE: this is a dedicated Okta API token, not the OIDC login client secret.
 */
export default function OktaIntegrationSettings({ onSaved }: { onSaved: () => void }) {
  const { actor } = useApp();
  const readOnly = !actor.isOwner;
  const [s, setS] = useState<OktaState | null>(null);
  const [token, setToken] = useState("");
  const [orgUrl, setOrgUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const load = () => api.get<OktaState>("/settings/okta-integration").then(setS);
  useEffect(() => { load(); }, []);
  if (!s) return null;

  const save = async (clear?: "apiToken" | "orgUrl") => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const body: Record<string, unknown> = clear
        ? { clear }
        : { ...(token.trim() ? { apiToken: token.trim() } : {}), ...(orgUrl.trim() ? { orgUrl: orgUrl.trim() } : {}) };
      const updated = await api.patch<OktaState>("/settings/okta-integration/credentials", body);
      setS(updated); setToken(""); if (clear === "orgUrl") setOrgUrl("");
      setMsg(clear ? "Cleared." : "Saved (encrypted).");
      onSaved();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not save"); }
    finally { setBusy(false); }
  };

  const runTest = async () => {
    setBusy(true); setError(null); setMsg(null); setTest(null);
    try { setTest(await api.post<TestResult>("/settings/okta-integration/test")); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not reach Okta"); }
    finally { setBusy(false); }
  };

  const th = s.oktaHints?.apiToken;
  const oh = s.oktaHints?.orgUrl;

  return (
    <div className="card cs-card">
      <div className="cs-head">Okta</div>
      <div className="cs-row">
        <div>
          <div className="cs-rl">Status</div>
          <div className="cs-rs">
            Directory API: {s.oktaConfigured ? "on" : "off"}. Powers the instance seed (Instances → Seed from Okta).
            {s.secretStore === "local" && <> <span style={{ color: "var(--amber, #a5770b)" }}>⚠ dev encryption — set <code>KMS_KEY_NAME</code> for KMS.</span></>}
          </div>
        </div>
        <div className="cs-controls">
          {s.oktaConfigured ? <span className="mini free">Configured</span> : <span className="mini off">Not configured</span>}
        </div>
      </div>

      {!readOnly && (
        <>
          <div className="cs-row">
            <div>
              <div className="cs-rl">API token {th?.hasValue && <span className="mini free">set ••••{th.hint}{sourceLabel(th.source)}</span>}</div>
              <div className="cs-rs">A read-only Okta API token (SSWS), or a service app with <code>okta.users.read</code>. Not the OIDC login secret. Encrypted at rest; shown only as last 4.</div>
            </div>
            <div className="cs-controls" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, minWidth: 240 }}>
              <input className="cs-time" type="password" autoComplete="off" value={token} disabled={busy}
                placeholder={th?.hasValue ? "•••• enter new to replace" : "paste Okta API token"}
                onChange={(e) => setToken(e.target.value)} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-pl" disabled={busy || !token.trim()} onClick={() => save()}>Save</button>
                {th?.hasValue && th.source === "in-app" && <button className="btn btn-ghost" disabled={busy} onClick={() => save("apiToken")}>Clear</button>}
              </div>
            </div>
          </div>

          <div className="cs-row">
            <div>
              <div className="cs-rl">Org URL {oh?.hasValue && <span className="mini free">{oh.hint}{sourceLabel(oh.source)}</span>}</div>
              <div className="cs-rs">Optional — defaults to your OIDC issuer's origin (e.g. <code>https://your-org.okta.com</code>). Only set this if your login issuer isn't your Okta org.</div>
            </div>
            <div className="cs-controls" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, minWidth: 240 }}>
              <input className="cs-time" value={orgUrl} disabled={busy} placeholder={oh?.hasValue ? oh.hint ?? "https://your-org.okta.com" : "https://your-org.okta.com"} onChange={(e) => setOrgUrl(e.target.value)} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-pl" disabled={busy || !orgUrl.trim()} onClick={() => save()}>Save</button>
                {oh?.hasValue && oh.source === "in-app" && <button className="btn btn-ghost" disabled={busy} onClick={() => save("orgUrl")}>Clear</button>}
              </div>
            </div>
          </div>

          <div className="cs-row">
            <div>
              <div className="cs-rl">Test directory</div>
              <div className="cs-rs">Reads the Okta directory and reports how many users carry city / department / whiteboard_number — proves the token works before you seed.</div>
            </div>
            <div className="cs-controls"><button className="btn btn-ghost" disabled={busy || !s.oktaConfigured} onClick={runTest}>Test</button></div>
          </div>

          {test && (
            <div className="cs-rs" style={{ marginTop: 6 }}>
              {test.ok
                ? <span style={{ color: "var(--green)" }}>✓ {test.users} active users — {test.withTuple} with city + department, {test.withBoard} with a whiteboard_number.</span>
                : <span style={{ color: "var(--red)" }}>✕ {test.error}</span>}
            </div>
          )}
        </>
      )}

      {msg && <div className="cs-rs" style={{ marginTop: 6 }}>{msg}</div>}
      {error && <div className="err-line">{error}</div>}
    </div>
  );
}
