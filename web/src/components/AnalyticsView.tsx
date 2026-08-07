import { useEffect, useState, type CSSProperties } from "react";
import { api, ApiError } from "../api/client";

interface CountRow {
  label: string;
  count: number;
}
interface UserRow {
  name: string;
  team: string;
  count: number;
}
interface FrictionRow {
  key: string;
  label: string;
  count: number;
  hint: string;
}
interface AnalyticsResponse {
  window: string;
  from: string;
  generatedAt: string;
  usageByEvent: CountRow[];
  auditByAction: CountRow[];
  byTeam: CountRow[];
  topUsers: UserRow[];
  friction: FrictionRow[];
}

const WINDOWS: { key: string; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

// Friendly names for raw telemetry event + audit action keys.
const NICE: Record<string, string> = {
  screen_view: "Screen views",
  prompt_shown: "Coverage prompt shown",
  prompt_accepted: "Coverage prompt accepted",
  prompt_dismissed: "Coverage prompt dismissed",
  prompt_snoozed: "Coverage prompt snoozed",
  intake_started: "Intake started",
  intake_suggestion_error: "Intake suggestion error",
  intake_created: "Project created (intake)",
  intake_abandoned: "Intake abandoned",
  goal_change_submitted: "Goal change requested",
};
const nice = (k: string) => NICE[k] ?? k.replace(/_/g, " ");

function Bars({ rows, empty }: { rows: { label: string; count: number; sub?: string }[]; empty: string }) {
  if (rows.length === 0) return <p style={{ fontSize: 13, color: "var(--soft)" }}>{empty}</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 190, flex: "none", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.label}
            {r.sub ? <span style={{ color: "var(--soft)" }}> · {r.sub}</span> : null}
          </div>
          <div style={{ flex: 1, background: "var(--line)", borderRadius: 4, height: 18, position: "relative" }}>
            <div style={{ width: `${Math.round((r.count / max) * 100)}%`, background: "var(--pl)", height: "100%", borderRadius: 4, minWidth: 2 }} />
          </div>
          <div style={{ width: 44, flex: "none", textAlign: "right", fontSize: 13, fontWeight: 700 }}>{r.count}</div>
        </div>
      ))}
    </div>
  );
}

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "14px 16px",
  marginBottom: 16,
};
const h3Style: CSSProperties = { margin: "0 0 4px", fontSize: 14, fontWeight: 700 };
const subStyle: CSSProperties = { margin: "0 0 12px", fontSize: 12, color: "var(--soft)" };

/**
 * Owner-only usage analytics. Reads GET /analytics (requireOwner) and shows
 * what's used, by team and user, plus a friction panel. Presentation only —
 * all aggregation happens server-side.
 */
export default function AnalyticsView() {
  const [window, setWindow] = useState("30d");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api
      .get<AnalyticsResponse>(`/analytics?window=${window}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Could not load analytics"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [window]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--soft)" }}>Window</span>
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            className={"subtab" + (window === w.key ? " on" : "")}
            style={{ fontSize: 13 }}
            onClick={() => setWindow(w.key)}
          >
            {w.label}
          </button>
        ))}
      </div>

      {error && <div className="err-line">{error}</div>}
      {loading && !data && <p style={{ fontSize: 13, color: "var(--soft)" }}>Loading…</p>}

      {data && (
        <>
          <p style={{ fontSize: 12, color: "var(--soft)", margin: "0 0 16px" }}>
            Since {new Date(data.from).toLocaleDateString()} · dummy/aggregate data only, no personal content.
          </p>

          <div style={cardStyle}>
            <h3 style={h3Style}>Needs attention — friction signals</h3>
            <p style={subStyle}>Workflows that required a correction or weren't smooth. Higher = more friction.</p>
            <Bars rows={data.friction.map((f) => ({ label: f.label, count: f.count }))} empty="No friction signals in this window." />
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3 }}>
              {data.friction.filter((f) => f.count > 0).map((f) => (
                <p key={f.key} style={{ margin: 0, fontSize: 11, color: "var(--soft)" }}>
                  <strong style={{ color: "var(--ink)" }}>{f.label}:</strong> {f.hint}
                </p>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={h3Style}>Most-used features</h3>
            <p style={subStyle}>UI telemetry — which workflows people reach for.</p>
            <Bars rows={data.usageByEvent.map((r) => ({ label: nice(r.label), count: r.count }))} empty="No usage recorded yet." />
          </div>

          <div style={cardStyle}>
            <h3 style={h3Style}>Actions taken</h3>
            <p style={subStyle}>Mutations from the audit trail.</p>
            <Bars rows={data.auditByAction.map((r) => ({ label: nice(r.label), count: r.count }))} empty="No actions in this window." />
          </div>

          <div style={cardStyle}>
            <h3 style={h3Style}>Activity by team</h3>
            <Bars rows={data.byTeam} empty="No team activity yet." />
          </div>

          <div style={cardStyle}>
            <h3 style={h3Style}>Most active users</h3>
            <Bars rows={data.topUsers.map((u) => ({ label: u.name, sub: u.team, count: u.count }))} empty="No user activity yet." />
          </div>
        </>
      )}
    </div>
  );
}
