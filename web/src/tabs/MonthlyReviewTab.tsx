import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { MonthlyReview } from "../api/types";
import { useApp } from "../state/AppContext";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Sub = "ov" | "co" | "de" | "pe" | "pi";
const SUBS: { k: Sub; label: string }[] = [
  { k: "ov", label: "Overview" },
  { k: "co", label: "Commercial" },
  { k: "de", label: "Delivery" },
  { k: "pe", label: "People & Capacity" },
  { k: "pi", label: "Pipeline & Governance" },
];

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
function recentMonths(count: number): { key: string; label: string }[] {
  const now = new Date();
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ key, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
  }
  return out;
}
const pctOf = (s: number | null): string => (s == null ? "—" : `${Math.round(s * 100)}%`);

/** One labelled progress bar. tone drives the fill colour. */
function Bar({ label, value, pct, tone = "accent" }: { label: string; value: string; pct: number; tone?: "accent" | "good" | "warn" | "bad" | "mut" }) {
  const bg =
    tone === "good" ? "var(--green)" : tone === "warn" ? "var(--amber)" : tone === "bad" ? "var(--red)" : "var(--pl)";
  return (
    <div className="mr-bar">
      <span className="mr-bl">{label}</span>
      <span className="mr-bt"><span className="mr-bf" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: bg, opacity: tone === "mut" ? 0.32 : 1 }} /></span>
      <span className="mr-bv">{value}</span>
    </div>
  );
}
/** Descending conversion funnel; each step shows its value and % of the step above. */
function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="mr-funnel">
      {steps.map((s, i) => {
        const drop = i > 0 && steps[i - 1].value > 0 ? Math.round((s.value / steps[i - 1].value) * 100) : null;
        return (
          <div className="mr-fstep" key={s.label}>
            <span className="mr-fl">{s.label}</span>
            <span className="mr-fbar" style={{ width: `${Math.max(10, (s.value / max) * 100)}%` }}>{s.value.toLocaleString()}</span>
            <span className="mr-fd">{drop != null ? `${drop}%` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

const DONUT_COLORS = ["var(--pl)", "var(--green)", "var(--amber)", "var(--red)", "var(--soft)"];
/** Donut chart from labelled slices. */
function Donut({ slices }: { slices: { label: string; value: number }[] }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const C = 2 * Math.PI * 42;
  let acc = 0;
  return (
    <div className="mr-donut">
      <svg viewBox="0 0 100 100" className="mr-donut-svg" aria-hidden="true">
        <g transform="rotate(-90 50 50)">
          {total > 0 && slices.map((s, i) => {
            const dash = (s.value / total) * C;
            const el = (
              <circle key={i} cx="50" cy="50" r="42" fill="none" stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
                strokeWidth="15" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} />
            );
            acc += dash;
            return el;
          })}
        </g>
        <text x="50" y="54" textAnchor="middle" className="mr-donut-total">{total}</text>
      </svg>
      <div className="mr-donut-legend">
        {slices.map((s, i) => (
          <div key={s.label} className="mr-leg"><span className="mr-leg-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />{s.label}<b>{s.value}</b></div>
        ))}
      </div>
    </div>
  );
}

/** Team × type share grid; cell intensity tracks share. */
function Heatmap({ cells }: { cells: { team: string; type: string; share: number | null; n: number }[] }) {
  const teams = [...new Set(cells.map((c) => c.team))];
  const types = [...new Set(cells.map((c) => c.type))];
  const at = (team: string, type: string) => cells.find((c) => c.team === team && c.type === type);
  return (
    <div className="mr-heat-wrap">
      <table className="mr-heat">
        <thead><tr><th></th>{types.map((t) => <th key={t}>{t}</th>)}</tr></thead>
        <tbody>
          {teams.map((team) => (
            <tr key={team}>
              <td className="mr-heat-row">{team.replace("Team_", "")}</td>
              {types.map((type) => {
                const c = at(team, type);
                const s = c?.share ?? null;
                return (
                  <td key={type} className="mr-heat-cell"
                    style={{ background: s == null ? "var(--bg)" : `color-mix(in srgb, var(--green) ${Math.round(s * 100)}%, var(--bg))` }}
                    title={c ? `${c.n} wanted` : "no cards"}>
                    {s == null ? "—" : `${Math.round(s * 100)}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tiny sparkline over the non-null points of a series (oldest → newest). */
function Spark({ series }: { series: (number | null)[] }) {
  const pts = series.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.i);
  const ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 68, H = 20;
  const x = (i: number) => (maxX === minX ? W : ((i - minX) / (maxX - minX)) * W);
  const y = (v: number) => (maxY === minY ? H / 2 : H - ((v - minY) / (maxY - minY)) * H);
  const d = pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="mr-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="var(--pl)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={x(last.i)} cy={y(last.v)} r="1.8" fill="var(--pl)" />
    </svg>
  );
}

/** MoM delta from a series' last two points. unit 'pct' shows points; betterUp colours it. */
function deltaOf(series: (number | null)[], unit: "pct" | "num", betterUp: boolean): { text: string; tone: "up" | "down" | "flat" } | null {
  if (series.length < 2) return null;
  const a = series[series.length - 2], b = series[series.length - 1];
  if (a == null || b == null) return null;
  const diff = b - a;
  const text = unit === "pct" ? `${diff >= 0 ? "+" : ""}${Math.round(diff * 100)} pts` : `${diff >= 0 ? "+" : ""}${Math.round(diff)}`;
  const tone: "up" | "down" | "flat" = !betterUp ? "flat" : diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  return { text: `${text} vs prev`, tone };
}

function Kpi({ k, v, d, tone, series }: { k: string; v: string; d?: string; tone?: "up" | "down" | "flat"; series?: (number | null)[] }) {
  return (
    <div className="mr-kpi">
      <div className="mr-k">{k}</div>
      <div className="mr-v">{v}</div>
      {d && <div className={"mr-d mr-" + (tone ?? "flat")}>{d}</div>}
      {series && <Spark series={series} />}
    </div>
  );
}

export default function MonthlyReviewTab({ reloadTick }: { reloadTick: number }) {
  const { teamNameOf } = useApp();
  const [month, setMonth] = useState<string | null>(null);
  const [sub, setSub] = useState<Sub>("ov");
  const [data, setData] = useState<MonthlyReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const months = useMemo(() => recentMonths(12), []);

  useEffect(() => {
    setError(null);
    api
      .get<MonthlyReview>(`/analytics/monthly-review${month ? `?month=${month}` : ""}`)
      .then(setData)
      .catch(() => setError("Could not load the monthly review."));
  }, [month, reloadTick]);

  if (error) return (<><div className="section-lbl">Analytics</div><div className="empty">{error}</div></>);
  if (!data) return <div className="empty">Loading…</div>;

  const d = data;
  const hs = (pick: (h: MonthlyReview["history"][number]) => number | null) => d.history.map(pick);
  const trendMax = Math.max(0.01, ...d.trend.map((t) => t.share ?? 0));
  const goalPct = d.goals.goalTotal > 0 ? d.goals.deliveredTotal / d.goals.goalTotal : 0;
  const hitPct = d.goals.projectsTotal > 0 ? d.goals.projectsHit / d.goals.projectsTotal : 0;
  const maxTypeN = Math.max(1, ...d.byType.map((t) => t.n));
  const maxLoad = Math.max(1, ...d.capacityNow.byTeam.map((t) => t.avgLoad));

  return (
    <>
      <div className="mr-head">
        <div className="section-lbl" style={{ margin: 0 }}>
          Analytics <span className="mini team">Monthly review</span>
          {d.isFrozen ? <span className="mini off" style={{ marginLeft: 6 }}>Final</span> : <span className="ms-live" style={{ marginLeft: 6 }}>live</span>}
        </div>
        <select className="mr-month" value={month ?? d.month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>

      <div className="mr-tabs">
        {SUBS.map((s) => (
          <button key={s.k} className={"mr-tab" + (sub === s.k ? " on" : "")} onClick={() => setSub(s.k)}>{s.label}</button>
        ))}
      </div>

      {/* OVERVIEW */}
      {sub === "ov" && (
        <>
          {(() => {
            const H = d.history;
            const shareS = H.map((h) => h.share);
            const soldS = H.map((h) => h.callsSold);
            const demandS = H.map((h) => h.demand);
            const hitS = H.map((h) => h.hitGoalPct);
            const loadS = H.map((h) => h.medianLoad);
            const dl = (s: (number | null)[], u: "pct" | "num", up: boolean) => deltaOf(s, u, up);
            const shareD = dl(shareS, "pct", true), soldD = dl(soldS, "num", true), demandD = dl(demandS, "num", false), hitD = dl(hitS, "pct", true);
            return (
              <div className="mr-kpis">
                <Kpi k="Market share" v={pctOf(d.marketShare.share)} d={shareD?.text} tone={shareD?.tone} series={shareS} />
                <Kpi k="Calls sold" v={String(d.marketShare.callsSold)} d={soldD?.text} tone={soldD?.tone} series={soldS} />
                <Kpi k="Demand (N)" v={String(d.marketShare.n)} d={demandD?.text} tone={demandD?.tone} series={demandS} />
                <Kpi k="Projects hit goal" v={pctOf(hitPct)} d={hitD?.text ?? `${d.goals.projectsHit} of ${d.goals.projectsTotal}`} tone={hitD?.tone} series={hitS} />
                <Kpi k="Median load (now)" v={d.capacityNow.medianLoad.toFixed(1)} series={loadS} />
              </div>
            );
          })()}
          <div className="mr-cards">
            <div className="mr-card">
              <h3>Market share trend</h3>
              <div className="mr-cs">Calls sold ÷ demand · last 6 months</div>
              <div className="mr-trend">
                {d.trend.map((t) => (
                  <div className="mr-tcol" key={t.month}>
                    <div className="mr-tbar" style={{ height: `${Math.max(4, ((t.share ?? 0) / trendMax) * 100)}%`, opacity: t.month === d.month ? 1 : 0.4 }}>
                      <b>{pctOf(t.share)}</b>
                    </div>
                    <div className="mr-tcl">{monthLabel(t.month).slice(0, 3)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mr-card">
              <h3>Team health</h3>
              <div className="mr-cs">Market share by team, this month</div>
              {d.byTeam.length === 0 ? <div className="empty" style={{ padding: 8 }}>No cards this month.</div> :
                d.byTeam.map((t) => (
                  <Bar key={t.team} label={t.team.replace("Team_", "")} value={pctOf(t.share)} pct={(t.share ?? 0) * 100}
                    tone={(t.share ?? 0) >= 0.6 ? "good" : (t.share ?? 0) >= 0.33 ? "accent" : "warn"} />
                ))}
            </div>
          </div>
        </>
      )}

      {/* COMMERCIAL */}
      {sub === "co" && (
        <>
          <div className="mr-cards">
            <div className="mr-card">
              <h3>Demand vs captured</h3>
              <div className="mr-cs">This month, org-wide</div>
              <Bar label="Demand (N)" value={String(d.marketShare.n)} pct={100} tone="mut" />
              <Bar label="Calls sold" value={String(d.marketShare.callsSold)} pct={d.marketShare.share ? d.marketShare.share * 100 : 0} />
              <div className="mr-cs" style={{ marginTop: 10 }}>Overall market share <b>{pctOf(d.marketShare.share)}</b></div>
            </div>
            <div className="mr-card">
              <h3>Conversion by project type</h3>
              <div className="mr-cs">Calls sold ÷ demand</div>
              {d.byType.map((t) => (
                <Bar key={t.type} label={t.type} value={pctOf(t.share)} pct={(t.share ?? 0) * 100}
                  tone={(t.share ?? 0) >= 0.6 ? "good" : "accent"} />
              ))}
            </div>
          </div>
          <div className="mr-card">
            <h3>Demand by project type</h3>
            <div className="mr-cs">Where the calls are wanted</div>
            {d.byType.map((t) => (
              <Bar key={t.type} label={t.type} value={String(t.n)} pct={(t.n / maxTypeN) * 100} tone="mut" />
            ))}
          </div>
          <div className="mr-cards">
            <div className="mr-card">
              <h3>Market share by expert pool</h3>
              <div className="mr-cs">Where we win across time zones</div>
              {d.byPool.length === 0 ? <div className="empty" style={{ padding: 8 }}>No cards this month.</div> :
                d.byPool.map((p) => (
                  <Bar key={p.pool} label={p.pool} value={pctOf(p.share)} pct={(p.share ?? 0) * 100}
                    tone={(p.share ?? 0) >= 0.6 ? "good" : (p.share ?? 0) >= 0.33 ? "accent" : "warn"} />
                ))}
            </div>
            <div className="mr-card">
              <h3>Top clients by demand</h3>
              <div className="mr-cs">Calls wanted · share captured</div>
              {d.topClients.length === 0 ? <div className="empty" style={{ padding: 8 }}>No clients this month.</div> :
                d.topClients.map((c) => (
                  <Bar key={c.client} label={c.client} value={`${c.n} · ${pctOf(c.share)}`} pct={(c.n / Math.max(1, d.topClients[0].n)) * 100} tone="mut" />
                ))}
            </div>
          </div>
          <div className="mr-cards">
            <div className="mr-card">
              <h3>Average deal size</h3>
              <div className="mr-cs">Calls wanted per project, by type</div>
              {(() => { const mx = Math.max(1, ...d.avgDealByType.map((t) => t.projects ? t.n / t.projects : 0)); return d.avgDealByType.map((t) => {
                const avg = t.projects ? t.n / t.projects : 0;
                return <Bar key={t.type} label={t.type} value={avg.toFixed(1)} pct={(avg / mx) * 100} tone="mut" />;
              }); })()}
              <div className="mr-line"><span>New vs repeat clients</span><b>{d.clientMix.newClients} new / {Math.max(0, d.clientMix.total - d.clientMix.newClients)} repeat</b></div>
            </div>
            <div className="mr-card">
              <h3>Unmet demand by PL</h3>
              <div className="mr-cs">Calls wanted minus sold</div>
              {d.unmetDemandByPL.length === 0 ? <div className="empty" style={{ padding: 8 }}>All demand captured.</div> :
                (() => { const mx = Math.max(1, ...d.unmetDemandByPL.map((p) => p.gap)); return d.unmetDemandByPL.map((p) => (
                  <Bar key={p.pl} label={p.pl} value={String(p.gap)} pct={(p.gap / mx) * 100} tone="warn" />
                )); })()}
            </div>
          </div>
          <div className="mr-cards">
            <div className="mr-card">
              <h3>Conversion funnel</h3>
              <div className="mr-cs">Calls wanted vs sold, this month</div>
              <Funnel steps={[{ label: "Demand (N)", value: d.marketShare.n }, { label: "Calls sold", value: d.marketShare.callsSold }]} />
            </div>
            <div className="mr-card">
              <h3>Competition (ghosts)</h3>
              <div className="mr-cs">Angles contested by a ghost deliverer</div>
              <div className="mr-v" style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 30 }}>
                {d.ghost.contested > 0 ? `${Math.round((d.ghost.won / d.ghost.contested) * 100)}%` : "—"}
              </div>
              <div className="mr-line"><span>Won</span><b>{d.ghost.won} of {d.ghost.contested}</b></div>
            </div>
          </div>
          {d.byBU.length > 1 && (
            <div className="mr-card">
              <h3>Market share by business unit</h3>
              <div className="mr-cs">Across BUs this month</div>
              {d.byBU.map((b) => (
                <Bar key={b.bu} label={b.bu} value={pctOf(b.share)} pct={(b.share ?? 0) * 100}
                  tone={(b.share ?? 0) >= 0.6 ? "good" : (b.share ?? 0) >= 0.33 ? "accent" : "warn"} />
              ))}
            </div>
          )}
          {d.heatmap.length > 0 && (
            <div className="mr-card">
              <h3>Share by team &amp; project type</h3>
              <div className="mr-cs">Where each team wins</div>
              <Heatmap cells={d.heatmap} />
            </div>
          )}
        </>
      )}

      {/* DELIVERY */}
      {sub === "de" && (
        <>
          <div className="mr-kpis">
            {(() => { const dd = deltaOf(hs((h) => h.delivered), "num", true); return (
              <Kpi k="Profiles delivered" v={d.goals.deliveredTotal.toLocaleString()} d={dd?.text} tone={dd?.tone} series={hs((h) => h.delivered)} />
            ); })()}
            <Kpi k="Goal total" v={d.goals.goalTotal.toLocaleString()} />
            {(() => { const dd = deltaOf(hs((h) => h.goalPct), "pct", true); return (
              <Kpi k="Delivered ÷ goal" v={pctOf(goalPct)} d={dd?.text} tone={dd?.tone} series={hs((h) => h.goalPct)} />
            ); })()}
            <Kpi k="Projects hit goal" v={pctOf(hitPct)} d={`${d.goals.projectsHit} of ${d.goals.projectsTotal}`} series={hs((h) => h.hitGoalPct)} />
            <Kpi k="Avg time to 1st" v={d.firstDeliverableTiming.avgHours == null ? "—" : `${d.firstDeliverableTiming.avgHours}h`} d={d.firstDeliverableTiming.completed ? `${d.firstDeliverableTiming.completed} completed` : "no data yet"} series={hs((h) => h.fdAvgHours)} />
            <Kpi k="Rework moves" v={String(d.rework)} d="backward stage changes" series={hs((h) => h.rework)} />
            <Kpi k="Overdue 1st (now)" v={String(d.overdueFirstDeliverables)} />
          </div>
          <div className="mr-card">
            <h3>Goal attainment</h3>
            <div className="mr-cs">Profiles delivered vs goal, projects created this month</div>
            <Bar label="Delivered" value={d.goals.deliveredTotal.toLocaleString()} pct={goalPct * 100}
              tone={goalPct >= 0.85 ? "good" : goalPct >= 0.6 ? "warn" : "bad"} />
            <Bar label="Goal" value={d.goals.goalTotal.toLocaleString()} pct={100} tone="mut" />
          </div>
          <div className="mr-cards">
            <div className="mr-card">
              <h3>Delivered by team</h3>
              <div className="mr-cs">Profiles delivered ÷ goal, this month</div>
              {d.deliveredByTeam.length === 0 ? <div className="empty" style={{ padding: 8 }}>No delivery this month.</div> :
                d.deliveredByTeam.map((t) => {
                  const p = t.goal > 0 ? t.delivered / t.goal : 0;
                  return <Bar key={t.team} label={t.team.replace("Team_", "")} value={`${t.delivered}/${t.goal}`} pct={p * 100}
                    tone={p >= 0.85 ? "good" : p >= 0.6 ? "warn" : "bad"} />;
                })}
            </div>
            <div className="mr-card">
              <h3>Sourcing split</h3>
              <div className="mr-cs">System vs custom (outside-system) profiles</div>
              {(() => { const tot = Math.max(1, d.customVsSystem.system + d.customVsSystem.custom); return (<>
                <Bar label="System" value={String(d.customVsSystem.system)} pct={(d.customVsSystem.system / tot) * 100} />
                <Bar label="Custom" value={String(d.customVsSystem.custom)} pct={(d.customVsSystem.custom / tot) * 100} tone="mut" />
              </>); })()}
            </div>
          </div>
          <div className="mr-cards">
            <div className="mr-card">
              <h3>Goal-attainment spread</h3>
              <div className="mr-cs">Projects by how close to goal they landed</div>
              {(() => { const mx = Math.max(1, ...d.goalDistribution.map((b) => b.count)); return d.goalDistribution.map((b) => (
                <Bar key={b.bucket} label={b.bucket} value={String(b.count)} pct={(b.count / mx) * 100}
                  tone={b.bucket === "100%+" ? "good" : b.bucket === "0–49%" ? "bad" : "accent"} />
              )); })()}
            </div>
            <div className="mr-card">
              <h3>Stage mix (now)</h3>
              <div className="mr-cs">Active assignments by stage</div>
              {d.stageMix.length === 0 ? <div className="empty" style={{ padding: 8 }}>No active assignments.</div> :
                (() => { const mx = Math.max(1, ...d.stageMix.map((s) => s.count)); return d.stageMix.map((s) => (
                  <Bar key={s.stage} label={s.stage} value={String(s.count)} pct={(s.count / mx) * 100} />
                )); })()}
            </div>
          </div>
          <div className="mr-cards">
            <div className="mr-card">
              <h3>Owes the client calls (now)</h3>
              <div className="mr-cs">Delivered below calls sold</div>
              {d.chase.length === 0 ? <div className="empty" style={{ padding: 8 }}>Nothing outstanding.</div> :
                d.chase.map((c) => (
                  <div className="mr-line" key={c.projectId}><span>{c.client}</span><b>{c.delivered} / {c.sold}</b></div>
                ))}
            </div>
            <div className="mr-card">
              <h3>Stuck in Admin (now)</h3>
              <div className="mr-cs">Idle past {`the auto-archive window`}</div>
              {d.stuck.length === 0 ? <div className="empty" style={{ padding: 8 }}>Nothing stuck.</div> :
                d.stuck.map((s) => (
                  <div className="mr-line" key={s.projectId}><span>{s.client}</span><b>{s.daysIdle}d</b></div>
                ))}
            </div>
          </div>
          <div className="mr-card">
            <h3>Top deliverers</h3>
            <div className="mr-cs">Profiles delivered this month</div>
            {d.topDeliverers.length === 0 ? <div className="empty" style={{ padding: 8 }}>No delivery this month.</div> :
              (() => { const mx = Math.max(1, ...d.topDeliverers.map((t) => t.delivered)); return (
                <table className="mr-lead">
                  <tbody>
                    {d.topDeliverers.map((t, i) => (
                      <tr key={t.name}>
                        <td className="mr-lead-rank">{i + 1}</td>
                        <td>{t.name}</td>
                        <td className="mr-lead-bar"><span style={{ width: `${(t.delivered / mx) * 100}%` }} /></td>
                        <td className="mr-lead-val">{t.delivered}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ); })()}
          </div>
          <p className="foot-note">Delivery is measured on projects created in the selected month, ghosts excluded. Chase and stuck lists are live (current state). Time-to-first-deliverable and rework accrue from stage changes going forward, so early months read low until history builds up.</p>
        </>
      )}

      {/* PEOPLE & CAPACITY */}
      {sub === "pe" && (
        <>
          <div className="mr-kpis">
            <Kpi k="Deliverers" v={String(d.capacityNow.people)} series={hs((h) => h.people)} />
            <Kpi k="Median load" v={d.capacityNow.medianLoad.toFixed(1)} series={hs((h) => h.medianLoad)} />
            <Kpi k="Over median" v={String(d.capacityNow.overMedian)} series={hs((h) => h.overMedian)} />
            <Kpi k="Idle (no load)" v={String(d.capacityNow.idle)} series={hs((h) => h.idle)} />
          </div>
          <div className="mr-cards">
            <div className="mr-card">
              <h3>Load by team</h3>
              <div className="mr-cs">Average weighted load right now (live)</div>
              {d.capacityNow.byTeam.length === 0 ? <div className="empty" style={{ padding: 8 }}>No deliverers online.</div> :
                d.capacityNow.byTeam.map((t) => (
                  <Bar key={t.teamId ?? "none"} label={(teamNameOf(t.teamId) || "Unassigned").replace("Team_", "")}
                    value={t.avgLoad.toFixed(1)} pct={(t.avgLoad / maxLoad) * 100}
                    tone={t.avgLoad >= maxLoad * 0.8 ? "bad" : t.avgLoad >= maxLoad * 0.5 ? "warn" : "accent"} />
                ))}
            </div>
            <div className="mr-card">
              <h3>Load by practice area</h3>
              <div className="mr-cs">Average weighted load right now (live)</div>
              {d.capacityNow.byPractice.length === 0 ? <div className="empty" style={{ padding: 8 }}>No deliverers online.</div> :
                (() => { const mx = Math.max(1, ...d.capacityNow.byPractice.map((p) => p.avgLoad)); return d.capacityNow.byPractice.map((p) => (
                  <Bar key={p.practice} label={p.practice} value={p.avgLoad.toFixed(1)} pct={(p.avgLoad / mx) * 100}
                    tone={p.avgLoad >= mx * 0.8 ? "bad" : p.avgLoad >= mx * 0.5 ? "warn" : "accent"} />
                )); })()}
            </div>
          </div>
          <div className="mr-cards">
            <div className="mr-card">
              <h3>Status right now</h3>
              <div className="mr-cs">People by availability</div>
              {(() => { const mx = Math.max(1, ...d.statusBreakdown.map((s) => s.count)); return d.statusBreakdown.map((s) => (
                <Bar key={s.status} label={s.status} value={String(s.count)} pct={(s.count / mx) * 100}
                  tone={s.status === "Available" ? "good" : s.status === "Offline" ? "mut" : "warn"} />
              )); })()}
            </div>
            <div className="mr-card">
              <h3>Roster</h3>
              <div className="mr-cs">Current headcount</div>
              <div className="mr-line"><span>Active people</span><b>{d.roster.active}</b></div>
              <div className="mr-line"><span>Logged in last 30 days</span><b>{d.roster.loggedInRecently}</b></div>
              <div className="mr-line"><span>Ghost deliverers</span><b>{d.roster.ghosts}</b></div>
              <div className="mr-line"><span>Deactivated</span><b>{d.roster.deactivated}</b></div>
            </div>
          </div>
          {d.capacityNow.trend.length > 0 && (
            <div className="mr-card">
              <h3>Utilisation trend</h3>
              <div className="mr-cs">Median weighted load, last 14 days</div>
              <div className="mr-trend">
                {(() => { const mx = Math.max(0.01, ...d.capacityNow.trend.map((t) => t.medianLoad)); return d.capacityNow.trend.map((t, i) => (
                  <div className="mr-tcol" key={t.date}>
                    <div className="mr-tbar" style={{ height: `${Math.max(4, (t.medianLoad / mx) * 100)}%`, opacity: i === d.capacityNow.trend.length - 1 ? 1 : 0.5 }}>
                      <b>{t.medianLoad.toFixed(1)}</b>
                    </div>
                    <div className="mr-tcl">{t.date.slice(5)}</div>
                  </div>
                )); })()}
              </div>
            </div>
          )}
          <p className="foot-note">Capacity is a live snapshot of the deliverer pool in your active instance. The utilisation trend builds from a daily snapshot, so it fills in over the coming days.</p>
        </>
      )}

      {/* PIPELINE & GOVERNANCE */}
      {sub === "pi" && (
        <>
          <div className="mr-kpis">
            {(() => { const dd = deltaOf(hs((h) => h.created), "num", true); return (
              <Kpi k="New projects" v={String(d.pipeline.created)} d={dd?.text} tone={dd?.tone} series={hs((h) => h.created)} />
            ); })()}
            <Kpi k="Active" v={String(d.pipeline.byStatus.active)} series={hs((h) => h.active)} />
            <Kpi k="Archived" v={String(d.pipeline.byStatus.archived)} series={hs((h) => h.archived)} />
            <Kpi k="Delivery closed" v={String(d.pipeline.byStatus.deliveryClosed)} series={hs((h) => h.deliveryClosed)} />
            <Kpi k="Auto-closed (idle)" v={String(d.autoArchived)} series={hs((h) => h.autoArchived)} />
            <Kpi k="Staffed rate" v={d.pipeline.created > 0 ? pctOf((d.pipeline.created - d.pipeline.byStatus.open) / d.pipeline.created) : "—"} d="reached staffing" />
          </div>
          <div className="mr-card">
            <h3>New projects by PL</h3>
            <div className="mr-cs">Created this month</div>
            {d.pipelineByPL.length === 0 ? <div className="empty" style={{ padding: 8 }}>No new projects.</div> :
              (() => { const mx = Math.max(1, ...d.pipelineByPL.map((p) => p.count)); return d.pipelineByPL.map((p) => (
                <Bar key={p.pl} label={p.pl} value={String(p.count)} pct={(p.count / mx) * 100} tone="mut" />
              )); })()}
          </div>
          <div className="mr-cards">
            <div className="mr-card">
              <h3>New projects by type</h3>
              <div className="mr-cs">Created this month</div>
              {d.pipeline.byType.length === 0 ? <div className="empty" style={{ padding: 8 }}>No new projects.</div> :
                <Donut slices={d.pipeline.byType.map((t) => ({ label: t.type, value: t.count }))} />}
            </div>
            <div className="mr-card">
              <h3>New projects by expert pool</h3>
              <div className="mr-cs">Created this month</div>
              {d.intakeByPool.length === 0 ? <div className="empty" style={{ padding: 8 }}>No new projects.</div> :
                (() => { const mx = Math.max(1, ...d.intakeByPool.map((p) => p.count)); return d.intakeByPool.map((p) => (
                  <Bar key={p.pool} label={p.pool} value={String(p.count)} pct={(p.count / mx) * 100} />
                )); })()}
            </div>
          </div>
          <div className="mr-cards">
            <div className="mr-card">
              <h3>Top actions this month</h3>
              <div className="mr-cs">From the audit trail</div>
              {d.auditByAction.length === 0 ? <div className="empty" style={{ padding: 8 }}>No audit activity.</div> :
                (() => { const mx = Math.max(1, ...d.auditByAction.map((a) => a.count)); return d.auditByAction.map((a) => (
                  <Bar key={a.action} label={a.action} value={String(a.count)} pct={(a.count / mx) * 100} tone="mut" />
                )); })()}
            </div>
            <div className="mr-card">
              <h3>Governance &amp; hygiene</h3>
              <div className="mr-cs">Current</div>
              <div className="mr-line"><span>Goal-change open</span><b>{d.goalChange.open}</b></div>
              <div className="mr-line"><span>Goal-change accepted / declined</span><b>{d.goalChangeOutcomes.accepted} / {d.goalChangeOutcomes.declined}</b></div>
              <div className="mr-line"><span>Stale calls-sold (angles)</span><b>{d.staleCallsSold}</b></div>
              <div className="mr-line"><span>Angles with no demand set</span><b>{d.hygiene.anglesNoDemand}</b></div>
              <div className="mr-line"><span>Live projects with no goal</span><b>{d.hygiene.projectsNoGoal}</b></div>
              <div className="mr-line"><span>Audit events this month</span><b>{d.auditEvents.toLocaleString()}</b></div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
