import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import { useApp } from "../state/AppContext";
import { Icon } from "./Icon";

interface Hint { hasValue: boolean; hint: string | null; source: "in-app" | "env" | "derived" | null }
interface OktaState {
  oktaConfigured: boolean;
  secretStore?: "kms" | "local";
  oktaHints?: { apiToken: Hint; clientId: Hint; privateKey: Hint; orgUrl: Hint; authMode: "oauth" | "token" | "none" };
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
  const [clientId, setClientId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const load = () => api.get<OktaState>("/settings/okta-integration").then(setS);
  useEffect(() => { load(); }, []);
  if (!s) return null;

  type Field = "apiToken" | "orgUrl" | "clientId" | "privateKey";
  const inputFor: Record<Field, [string, (v: string) => void]> = {
    apiToken: [token, setToken], orgUrl: [orgUrl, setOrgUrl], clientId: [clientId, setClientId], privateKey: [privateKey, setPrivateKey],
  };

  // Save one field's current input; or clear it when clear=true.
  const save = async (field: Field, clear = false) => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const [val, setVal] = inputFor[field];
      const body = clear ? { clear: field } : { [field]: val.trim() };
      const updated = await api.patch<OktaState>("/settings/okta-integration/credentials", body);
      setS(updated); setVal("");
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

  const h = s.oktaHints;
  const oh = h?.orgUrl;
  const authMode = h?.authMode ?? "none";

  const credRow = (
    field: "apiToken" | "clientId" | "privateKey",
    label: string,
    desc: ReactNode,
    value: string,
    setValue: (v: string) => void,
    opts?: { textarea?: boolean; masked?: boolean }
  ) => {
    const hint = h?.[field];
    return (
      <div className="cs-row">
        <div>
          <div className="cs-rl">{label} {hint?.hasValue && <span className="mini free">set ••••{hint.hint}{sourceLabel(hint.source)}</span>}</div>
          <div className="cs-rs">{desc}</div>
        </div>
        <div className="cs-controls" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, minWidth: 240 }}>
          {opts?.textarea ? (
            <textarea className="cs-time" autoComplete="off" rows={3} value={value} disabled={busy}
              placeholder={hint?.hasValue ? "•••• paste new PEM to replace" : "-----BEGIN PRIVATE KEY-----"}
              onChange={(e) => setValue(e.target.value)} style={{ fontFamily: "var(--mono, monospace)", fontSize: 11 }} />
          ) : (
            <input className="cs-time" type={opts?.masked ? "password" : "text"} autoComplete="off" value={value} disabled={busy}
              placeholder={hint?.hasValue ? "•••• enter new to replace" : label}
              onChange={(e) => setValue(e.target.value)} />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-pl" disabled={busy || !value.trim()} onClick={() => save(field)}>Save</button>
            {hint?.hasValue && hint.source === "in-app" && <button className="btn btn-ghost" disabled={busy} onClick={() => save(field, true)}>Clear</button>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="card cs-card">
      <div className="cs-head">Okta</div>
      <div className="cs-row">
        <div>
          <div className="cs-rl">Status</div>
          <div className="cs-rs">
            Directory API: {s.oktaConfigured ? "on" : "off"}
            {s.oktaConfigured && <> · auth: <strong>{authMode === "oauth" ? "OAuth (okta.users.read)" : "SSWS token"}</strong></>}. Powers the instance seed (Instances → Seed from Okta).
            {s.secretStore === "local" && <> <span style={{ color: "var(--amber, #a5770b)" }}><Icon name="alert" size={12} /> dev encryption — set <code>KMS_KEY_NAME</code> for KMS.</span></>}
          </div>
        </div>
        <div className="cs-controls">
          {s.oktaConfigured ? <span className="mini free">Configured</span> : <span className="mini off">Not configured</span>}
        </div>
      </div>

      {!readOnly && (
        <>
          <div className="cs-rl" style={{ marginTop: 10 }}>Recommended — OAuth (API Services app, scope <code>okta.users.read</code>)</div>
          {credRow("clientId", "Client ID", <>The client ID of your Okta <strong>API Services</strong> app (public value). Grant it only the <code>okta.users.read</code> scope.</>, clientId, setClientId)}
          {credRow("privateKey", "Private key (PEM)", <>The app's private key (PKCS8 PEM). Used to sign a short-lived JWT — no long-lived token is stored. Encrypted at rest.</>, privateKey, setPrivateKey, { textarea: true })}

          <div className="cs-rl" style={{ marginTop: 10 }}>Alternative — SSWS token</div>
          {credRow("apiToken", "API token", <>A read-only Okta API token (SSWS). Used only when no OAuth client is set. Not the OIDC login secret.</>, token, setToken, { masked: true })}

          <div className="cs-rl" style={{ marginTop: 10 }}>Org URL</div>
          <div className="cs-row">
            <div>
              <div className="cs-rl">Org base URL {oh?.hasValue && <span className="mini free">{oh.hint}{sourceLabel(oh.source)}</span>}</div>
              <div className="cs-rs">Optional — defaults to your OIDC issuer's origin (e.g. <code>https://your-org.okta.com</code>). Only set this if your login issuer isn't your Okta org.</div>
            </div>
            <div className="cs-controls" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, minWidth: 240 }}>
              <input className="cs-time" value={orgUrl} disabled={busy} placeholder={oh?.hint ?? "https://your-org.okta.com"} onChange={(e) => setOrgUrl(e.target.value)} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-pl" disabled={busy || !orgUrl.trim()} onClick={() => save("orgUrl")}>Save</button>
                {oh?.hasValue && oh.source === "in-app" && <button className="btn btn-ghost" disabled={busy} onClick={() => save("orgUrl", true)}>Clear</button>}
              </div>
            </div>
          </div>

          <div className="cs-row">
            <div>
              <div className="cs-rl">Test directory</div>
              <div className="cs-rs">Reads the Okta directory and reports how many users carry city / department / whiteboard_number — proves the credentials work before you seed.</div>
            </div>
            <div className="cs-controls"><button className="btn btn-ghost" disabled={busy || !s.oktaConfigured} onClick={runTest}>Test</button></div>
          </div>

          {test && (
            <div className="cs-rs" style={{ marginTop: 6 }}>
              {test.ok
                ? <span style={{ color: "var(--green)" }}><Icon name="check" size={12} /> {test.users} active users — {test.withTuple} with city + department, {test.withBoard} with a whiteboard_number.</span>
                : <span style={{ color: "var(--red)" }}><Icon name="x" size={12} /> {test.error}</span>}
            </div>
          )}
        </>
      )}

      {msg && <div className="cs-rs" style={{ marginTop: 6 }}>{msg}</div>}
      {error && <div className="err-line">{error}</div>}
    </div>
  );
}
