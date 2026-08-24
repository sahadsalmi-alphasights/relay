import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, ApiError } from "../api/client";
import { useApp } from "../state/AppContext";

/* ----------------------------- types ----------------------------- */
interface VacBlock { start: string; end: string; type: string }
interface Member { id: string; name: string; email: string; teamId: string | null; teamName: string | null; seniority: string | null; vacations: VacBlock[] }
interface Closure { id: string; name: string; startDate: string; endDate: string }
interface BusyPeriod { id: string; label: string; startDate: string; endDate: string }
interface PublicHoliday { id: string; name: string; holidayDate: string; teamId: string | null; reqTotal: number; reqSenior: number; reqMid: number; reqJunior: number; coverage: string[] }
interface Quarter { label: string; quarter: number; year: number; start: string; end: string; deadline: string }
interface Team { id: string; name: string }
interface VacationData {
  me: { id: string; email: string };
  window: { from: string; to: string };
  bambooConfigured: boolean;
  quarters: Quarter[];
  members: Member[];
  closures: Closure[];
  publicHolidays: PublicHoliday[];
  busyPeriods: BusyPeriod[];
  teams: Team[];
}

/* ----------------------------- date helpers ----------------------------- */
const d = (s: string) => { const [y, m, day] = s.split("-").map(Number); return new Date(y, m - 1, day); };
const fmt = (dt: Date) => dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtLong = (dt: Date) => dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
const addDays = (dt: Date, n: number) => { const x = new Date(dt); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (dt: Date) => { const x = new Date(dt); const wd = x.getDay(); x.setDate(x.getDate() + (wd === 0 ? -6 : 1 - wd)); x.setHours(0, 0, 0, 0); return x; };
const overlap = (aS: Date, aE: Date, bS: Date, bE: Date) => aS <= bE && bS <= aE;
function halvesOfWeek(ws: Date) {
  return [
    { start: ws, end: addDays(ws, 2), tag: "Mon–Wed" },
    { start: addDays(ws, 3), end: addDays(ws, 6), tag: "Thu–Sun" },
  ];
}
function halfPeriods(anchor: Date, weeks: number) {
  const out: { start: Date; end: Date; tag: string }[] = [];
  for (let i = 0; i < weeks; i++) out.push(...halvesOfWeek(addDays(anchor, i * 7)));
  return out;
}

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", marginBottom: 16 };
const swatch = (bg: string): CSSProperties => ({ width: 10, height: 10, borderRadius: 3, background: bg, display: "inline-block", flexShrink: 0 });
const VAC = "#2a78d6", CLOSE = "#1baf7a", PUB = "#e87ba4", YOU = "#4a3aa7";
const BUSY_TEXTURE = "repeating-linear-gradient(45deg, rgba(11,11,11,0.28) 0 1.5px, transparent 1.5px 5px)";
const NOT_SUB_BG = "repeating-linear-gradient(45deg,#f3d9d9 0 4px,#fce8e8 4px 8px)";
const BAMBOOHR_URL = "https://www.bamboohr.com/";
const SUB_TABS = [
  { key: "dash", label: "Dashboard" },
  { key: "mine", label: "My Vacation" },
  { key: "team", label: "Team View" },
  { key: "plan", label: "Plan My Trip" },
  { key: "admin", label: "Holidays & Coverage" },
] as const;
type Sub = (typeof SUB_TABS)[number]["key"];

export default function VacationTab({ reloadTick }: { reloadTick: number }) {
  const { actor } = useApp();
  const [data, setData] = useState<VacationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState<Sub>("dash");
  const [teamId, setTeamId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const qs = teamId ? `?teamId=${teamId}` : "";
      setData(await api.get<VacationData>(`/vacation/data${qs}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load vacation data");
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick, teamId]);

  const mutate = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That change could not be saved");
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <div className="empty">{error}</div>;
  if (!data) return <div className="empty">Loading…</div>;

  const me = data.members.find((m) => m.email.toLowerCase() === data.me.email.toLowerCase());
  const open = openQuarter(data);
  const meLoggedOpen = !!(open && me && me.vacations.some((v) => overlap(d(v.start), d(v.end), d(open.start), d(open.end))));

  return (
    <div>
      <div className="section-lbl" style={{ marginBottom: 4 }}>Vacation Planner</div>

      {/* Persistent deadline banner */}
      {open && !meLoggedOpen && !bannerDismissed && (
        <DeadlineBanner quarter={open} onSeeTeam={() => setSub("team")} onDismiss={() => setBannerDismissed(true)} />
      )}

      <div className="dl-view-switch settings-subnav" role="group" aria-label="Vacation section" style={{ marginBottom: 14 }}>
        {SUB_TABS.map((t) => (
          <button key={t.key} className={"btn-sm " + (sub === t.key ? "btn-pl" : "btn-ghost")} onClick={() => setSub(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <div className="err-line" style={{ marginBottom: 12 }}>{error}</div>}

      {sub === "dash" && <Dashboard data={data} me={me} meId={actor.id} goto={setSub} />}
      {sub === "mine" && <MyVacation data={data} me={me} />}
      {sub === "team" && <TeamView data={data} teamId={teamId} setTeamId={setTeamId} meId={actor.id} />}
      {sub === "plan" && <PlanTrip data={data} meEmail={data.me.email} />}
      {sub === "admin" && <AdminPanel data={data} busy={busy} mutate={mutate} />}
    </div>
  );
}

/* ----------------------------- Dashboard (Timeline / gantt) ----------------------------- */
const HEAVY_FRAC = 0.3; // ≥30% of the team off in a week ⇒ capacity risk (heuristic until a real coverage baseline exists)

function Dashboard({ data, me, meId, goto }: { data: VacationData; me: Member | undefined; meId: string; goto: (s: Sub) => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const open = openQuarter(data);

  // Timeline window: 8 weeks from the start of this week.
  const WEEKS = 8, totalDays = WEEKS * 7;
  const win0 = startOfWeek(today);
  const winEnd = addDays(win0, totalDays - 1);
  const pct = (dt: Date) => Math.max(0, Math.min(1, (dt.getTime() - win0.getTime()) / 86400000 / totalDays)) * 100;
  const barFor = (s: Date, e: Date) => { const left = pct(s); return { left, width: Math.max(1.4, pct(addDays(e, 1)) - left) }; };

  // Widget 4 — "my team": scope to the whiteboard team. Whiteboard isn't wired
  // yet (deferred), so we scope by the app team (teamId) as the stand-in. A
  // switcher lets you view any team or the whole BU; default to my own team.
  const [scope, setScope] = useState<string>(me?.teamId ?? "all"); // teamId | "all"
  const team = (scope === "all" ? data.members : data.members.filter((m) => m.teamId === scope))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const size = team.length || 1;
  const scopeLabel = scope === "all" ? "Whole BU" : data.teams.find((t) => t.id === scope)?.name ?? "Team";

  // Per-week capacity risk (widget 6).
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const ws = addDays(win0, i * 7), we = addDays(ws, 6);
    const outNames = team.filter((m) => m.vacations.some((v) => overlap(d(v.start), d(v.end), ws, we))).map((m) => m.name);
    return { i, ws, we, outNames };
  });
  const heavy = (n: number) => n >= 2 && n / size >= HEAVY_FRAC;
  const heavyWeeks = weeks.filter((w) => heavy(w.outNames.length));

  // Overlay bands (holidays + closures) within the window.
  const bands = [
    ...data.closures.filter((c) => overlap(d(c.startDate), d(c.endDate), win0, winEnd)).map((c) => ({ s: d(c.startDate), e: d(c.endDate), color: "rgba(27,175,122,0.16)", label: c.name })),
    ...data.publicHolidays.filter((h) => overlap(d(h.holidayDate), d(h.holidayDate), win0, winEnd)).map((h) => ({ s: d(h.holidayDate), e: d(h.holidayDate), color: "rgba(232,123,164,0.20)", label: h.name })),
  ];
  const deadlineIn = open && d(open.deadline) >= win0 && d(open.deadline) <= winEnd ? pct(d(open.deadline)) : null;

  // Supporting widgets' data.
  const myUpcoming = (me?.vacations ?? []).filter((v) => d(v.end) >= today).sort((a, b) => d(a.start).getTime() - d(b.start).getTime());
  const holidaysUpcoming = [
    ...data.closures.map((c) => ({ date: c.startDate, name: c.name, kind: "Closure" as const })),
    ...data.publicHolidays.map((h) => ({ date: h.holidayDate, name: h.name, kind: "Holiday" as const })),
  ].filter((x) => d(x.date) >= today).sort((a, b) => d(a.date).getTime() - d(b.date).getTime()).slice(0, 6);
  const quiet = halfPeriods(win0, 6)
    .map((p) => ({ p, count: team.filter((m) => m.id !== meId && m.vacations.some((v) => overlap(d(v.start), d(v.end), p.start, p.end))).length }))
    .filter((x) => !isClosure(data, x.p.start, x.p.end))
    .sort((a, b) => a.count - b.count).slice(0, 4);
  const coverage = data.publicHolidays.map((h) => ({ h, short: Math.max(0, h.reqTotal - h.coverage.length) })).slice(0, 6);

  const LABEL = 140;
  const chipBtn: CSSProperties = { fontSize: 12, fontWeight: 600, color: VAC, background: "transparent", border: 0, cursor: "pointer", padding: 0 };
  const wCard: CSSProperties = { ...card, margin: 0 };
  const wH: CSSProperties = { fontSize: 13, fontWeight: 700, margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 };
  const riskColor = (n: number) => (heavy(n) ? "var(--red)" : n / size >= 0.15 ? "#ec835a" : n >= 1 ? "#fab219" : "var(--line)");

  return (
    <>
      {/* ---- header / request-by ---- */}
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Team time-off timeline</div>
            <div style={{ fontSize: 12.5, color: "var(--soft)" }}>
              {scopeLabel} · {size} {size === 1 ? "person" : "people"} · next {WEEKS} weeks
              {open && <> · <strong>{open.label}</strong> requests due {fmtLong(d(open.deadline))}</>}
            </div>
          </div>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            title="Which team to show"
            style={{ font: "inherit", fontSize: 12.5, fontWeight: 600, padding: "6px 10px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }}
          >
            {me?.teamId && <option value={me.teamId}>My team ({me.teamName ?? "—"})</option>}
            <option value="all">Whole BU ({data.members.length})</option>
            {data.teams.filter((t) => t.id !== me?.teamId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn-sm btn-ghost" onClick={() => goto("team")}>Full team view</button>
          <button className="btn-sm btn-pl" onClick={() => goto("plan")}>Request time off</button>
        </div>
      </div>

      {/* ---- GANTT hero ---- */}
      <div style={card}>
        {heavyWeeks.length > 0 && (
          <div style={{ borderRadius: 9, padding: "8px 12px", background: "rgba(209,67,74,0.12)", border: "1px solid var(--red)", color: "var(--red)", fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>
            ⚠ Capacity risk: {heavyWeeks.map((w) => fmt(w.ws)).join(", ")} — ≥{Math.round(HEAVY_FRAC * 100)}% of the team off. Discourage new leave / arrange cover.
          </div>
        )}
        {!data.bambooConfigured ? (
          <div style={{ fontSize: 13, color: "var(--soft)" }}>BambooHR isn't connected — the timeline fills in once it is.</div>
        ) : (
          <div style={{ position: "relative", overflowX: "auto" }}>
            {/* week axis */}
            <div style={{ display: "flex", marginLeft: LABEL, borderBottom: "1px solid var(--line)", paddingBottom: 4, marginBottom: 6 }}>
              {weeks.map((w) => (
                <div key={w.i} style={{ flex: 1, fontSize: 10, color: "var(--soft)", textAlign: "center", fontWeight: 600 }}>{fmt(w.ws)}</div>
              ))}
            </div>
            {/* body with overlay */}
            <div style={{ position: "relative" }}>
              {/* overlay: bands + today + deadline (aligned to tracks) */}
              <div style={{ position: "absolute", left: LABEL, right: 0, top: 0, bottom: 0, pointerEvents: "none" }}>
                {bands.map((b, i) => { const { left, width } = barFor(b.s, b.e); return <div key={i} title={b.label} style={{ position: "absolute", left: `${left}%`, width: `${width}%`, top: 0, bottom: 0, background: b.color }} />; })}
                <div title="Today" style={{ position: "absolute", left: `${pct(today)}%`, top: 0, bottom: 0, width: 2, background: "var(--ink)", opacity: 0.35 }} />
                {deadlineIn !== null && <div title="Requests due" style={{ position: "absolute", left: `${deadlineIn}%`, top: 0, bottom: 0, width: 2, background: "var(--amber, #b7791f)" }} />}
              </div>
              {/* rows */}
              {team.map((m) => {
                const blocks = m.vacations.filter((v) => overlap(d(v.start), d(v.end), win0, winEnd));
                return (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", height: 26 }}>
                    <div style={{ width: LABEL, flex: "none", fontSize: 12, fontWeight: m.id === meId ? 700 : 500, color: m.id === meId ? YOU : "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 8 }}>
                      {m.name}{m.id === meId ? " (you)" : ""}
                    </div>
                    <div style={{ position: "relative", flex: 1, height: 18, borderRadius: 4, background: "repeating-linear-gradient(90deg, transparent 0 calc(12.5% - 1px), var(--line) calc(12.5% - 1px) 12.5%)" }}>
                      {blocks.map((v, i) => { const { left, width } = barFor(d(v.start), d(v.end)); return <div key={i} title={`${v.type}: ${v.start}–${v.end}`} style={{ position: "absolute", left: `${left}%`, width: `${width}%`, top: 2, bottom: 2, background: VAC, borderRadius: 4 }} />; })}
                    </div>
                  </div>
                );
              })}
              {team.length === 0 && <div style={{ fontSize: 13, color: "var(--soft)", padding: 8 }}>No one in your team scope.</div>}
              {/* risk strip */}
              <div style={{ display: "flex", alignItems: "center", height: 30, marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                <div style={{ width: LABEL, flex: "none", fontSize: 11, fontWeight: 700, color: "var(--soft)" }}>Off / capacity</div>
                <div style={{ flex: 1, display: "flex", gap: 3 }}>
                  {weeks.map((w) => (
                    <div key={w.i} title={w.outNames.join(", ") || "no one"} style={{ flex: 1, height: 18, borderRadius: 4, background: riskColor(w.outNames.length), color: w.outNames.length ? "#fff" : "var(--soft)", fontSize: 10.5, fontWeight: 700, display: "grid", placeItems: "center" }}>{w.outNames.length}</div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11.5, color: "var(--soft)", marginTop: 12 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={swatch(VAC)} /> Time off</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ ...swatch("rgba(27,175,122,0.5)") }} /> Closure</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ ...swatch("rgba(232,123,164,0.6)"), borderRadius: "50%" }} /> Public holiday</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, background: "var(--amber, #b7791f)" }} /> Requests due</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={swatch("var(--red)")} /> ≥{Math.round(HEAVY_FRAC * 100)}% off (risk)</span>
            </div>
          </div>
        )}
      </div>

      {/* ---- supporting widgets ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }} className="vac-dash-grid">
        {/* 1 · My submitted time off */}
        <div style={wCard}>
          <h2 style={wH}>My time off <button style={{ ...chipBtn, marginLeft: "auto" }} onClick={() => goto("mine")}>Details →</button></h2>
          {myUpcoming.length === 0 ? <div style={{ fontSize: 12.5, color: "var(--soft)" }}>Nothing booked ahead. <button style={chipBtn} onClick={() => goto("plan")}>Book →</button></div>
            : myUpcoming.slice(0, 5).map((v, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}>
                <span style={swatch(VAC)} /><span style={{ fontWeight: 600 }}>{fmt(d(v.start))}–{fmt(d(v.end))}</span><span style={{ color: "var(--soft)", marginLeft: "auto", fontSize: 11.5 }}>{v.type}</span>
              </div>
            ))}
        </div>

        {/* 2 · Company holidays */}
        <div style={wCard}>
          <h2 style={wH}>Company holidays</h2>
          {holidaysUpcoming.length === 0 ? <div style={{ fontSize: 12.5, color: "var(--soft)" }}>None upcoming.</div>
            : holidaysUpcoming.map((h, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}>
                <span style={{ ...swatch(h.kind === "Closure" ? CLOSE : PUB), borderRadius: h.kind === "Holiday" ? "50%" : 3 }} />
                <span style={{ fontWeight: 600 }}>{fmt(d(h.date))}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
              </div>
            ))}
        </div>

        {/* 3 · Quarterly planning window */}
        <div style={wCard}>
          <h2 style={wH}>Planning windows</h2>
          {data.quarters.slice(0, 4).map((q) => (
            <div key={q.label} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", fontSize: 12.5 }}>
              <span style={{ fontWeight: 600 }}>{q.label}</span>
              <span style={{ marginLeft: "auto", color: "var(--soft)", fontSize: 11.5 }}>due {fmtLong(d(q.deadline))}</span>
              {open && q.label === open.label && <span className="mini free" style={{ fontSize: 10 }}>Open</span>}
            </div>
          ))}
        </div>

        {/* 5 · Lower-overlap half-weeks */}
        <div style={wCard}>
          <h2 style={wH}>Best weeks to book <button style={{ ...chipBtn, marginLeft: "auto" }} onClick={() => goto("plan")}>Plan →</button></h2>
          {quiet.map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 12.5 }}>
              <span style={{ width: 96, fontWeight: 600 }}>{fmt(b.p.start)} <span style={{ color: "var(--soft)", fontWeight: 500, fontSize: 11 }}>{b.p.tag}</span></span>
              <div style={{ flex: 1, height: 7, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, (b.count / size) * 100) || 4}%`, background: heavy(b.count) ? "var(--red)" : b.count ? "#fab219" : "var(--green)" }} /></div>
              <span style={{ width: 44, textAlign: "right", color: "var(--soft)", fontSize: 11 }}>{b.count} off</span>
            </div>
          ))}
        </div>

        {/* 6 · Heavy overlap — who's off */}
        <div style={wCard}>
          <h2 style={wH}>Heavy-overlap weeks</h2>
          {heavyWeeks.length === 0 ? <div style={{ fontSize: 12.5, color: "var(--green)" }}>No weeks below capacity in the next {WEEKS}. 🎉</div>
            : heavyWeeks.map((w) => (
              <div key={w.i} style={{ padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}>
                <div style={{ fontWeight: 700, color: "var(--red)" }}>{fmt(w.ws)}–{fmt(w.we)} · {w.outNames.length}/{size} off</div>
                <div style={{ color: "var(--soft)", fontSize: 11.5 }}>{w.outNames.join(", ")}</div>
              </div>
            ))}
        </div>

        {/* 7 · Public-holiday coverage */}
        <div style={wCard}>
          <h2 style={wH}>Holiday coverage <button style={{ ...chipBtn, marginLeft: "auto" }} onClick={() => goto("admin")}>Manage →</button></h2>
          {coverage.length === 0 ? <div style={{ fontSize: 12.5, color: "var(--soft)" }}>No public holidays configured.</div>
            : coverage.map(({ h, short }) => (
              <div key={h.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}>
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                <span style={{ marginLeft: "auto" }} className={short ? "mini off" : "mini free"}>{short ? `${short} short` : "Covered"}</span>
              </div>
            ))}
        </div>
      </div>

      <style>{`@media (max-width: 900px){ .vac-dash-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}

/* ----------------------------- Diagnostics (owner test buttons) ----------------------------- */
function Diagnostics() {
  const CHECKS = [
    { key: "connection", label: "BambooHR connection", hint: "Can we reach the employee directory?" },
    { key: "timeoff", label: "Time-off fetch", hint: "Approved time-off in the sync window." },
    { key: "holidays", label: "Public holidays", hint: "Read the office's public holidays from BambooHR (next 12 months)." },
    { key: "matching", label: "People matching", hint: "Do BambooHR emails match CapTracker people?" },
    { key: "canbook", label: "Can book time off?", hint: "Safely probes whether the token can CREATE time-off requests (no record is created)." },
  ] as const;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const run = async (key: string) => {
    setBusyKey(key);
    try {
      const r = await api.get<Record<string, unknown>>(`/vacation/diagnostics?check=${key}`);
      const ok = r.ok !== false && !r.error;
      let text: string;
      if (key === "connection") text = ok ? `✓ Reachable — ${r.employees} employees, ${r.withEmail} with a work email` : `✕ ${r.error}`;
      else if (key === "canbook")
        text = ok
          ? `${r.canWrite ? "✓ Can book" : "✕ Cannot book (read-only)"} — ${r.detail}`
          : `✕ ${r.error}`;
      else if (key === "timeoff")
        text = ok
          ? `✓ ${r.count} request(s) — ${r.approved} approved, ${r.pending} pending${r.other ? `, ${r.other} other` : ""} · dates ${r.earliest ?? "—"} → ${r.latest ?? "—"}`
          : `✕ ${r.error}`;
      else if (key === "holidays") {
        const hs = (r.holidays as { name: string; start: string }[] | undefined) ?? [];
        const scope = r.location ? ` for ${r.location}` : "";
        const filtered = typeof r.total === "number" && r.total !== r.count ? ` (of ${r.total} company-wide)` : "";
        text = ok
          ? hs.length
            ? `✓ ${r.count} holiday(s)${scope}${filtered}: ${hs.map((h) => `${h.name} (${h.start})`).join(", ")}`
            : `✓ Reachable, but no public holidays${scope} in the next 12 months`
          : `✕ ${r.error}`;
      }
      else text = ok
        ? `✓ ${r.matched}/${r.peopleInBu} people matched · ${r.bambooWithTimeOff} BambooHR people have time-off` +
          ((r.unmatchedBambooEmails as string[])?.length ? ` · unmatched BambooHR emails: ${(r.unmatchedBambooEmails as string[]).join(", ")}` : "")
        : `✕ ${r.error}`;
      // For the write probe, colour by whether booking is possible, not by whether the request succeeded.
      const displayOk = key === "canbook" ? ok && r.canWrite === true : ok;
      setResults((p) => ({ ...p, [key]: { ok: displayOk, text } }));
    } catch (e) {
      setResults((p) => ({ ...p, [key]: { ok: false, text: `✕ ${e instanceof ApiError ? e.message : "request failed"}` } }));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div style={card}>
      <h2 style={{ fontSize: 14, margin: "0 0 4px" }}>BambooHR sync diagnostics</h2>
      <p style={{ fontSize: 12, color: "var(--soft)", margin: "0 0 12px" }}>Test each data source and see the exact result or error the sync would hit.</p>
      {CHECKS.map((c) => {
        const res = results[c.key];
        return (
          <div key={c.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{c.label}</div>
              <div style={{ fontSize: 12, color: "var(--soft)" }}>{c.hint}</div>
              {res && <div style={{ fontSize: 12.5, marginTop: 4, color: res.ok ? "var(--green)" : "var(--red)", wordBreak: "break-word" }}>{res.text}</div>}
            </div>
            <button className="btn-sm btn-ghost" disabled={busyKey === c.key} onClick={() => run(c.key)}>
              {busyKey === c.key ? "Testing…" : "Test"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DeadlineBanner({ quarter, onSeeTeam, onDismiss }: { quarter: Quarter; onSeeTeam: () => void; onDismiss: () => void }) {
  const left = daysBetween(new Date(), d(quarter.deadline));
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#fff8ea", border: "1px solid #f2d799", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ fontSize: 18 }}>⏳</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: 2, color: "#3a2c00" }}>
          {quarter.label} vacation is due {left >= 0 ? `in ${left} days` : "— window closed"} — you haven't logged anything yet
        </div>
        <div style={{ color: "#6b5a1f", fontSize: 13 }}>
          Submission window closes <strong>{fmtLong(d(quarter.deadline))}</strong>. Log your time off in BambooHR before then — late requests can be declined.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <a className="btn-sm btn-pl" href={BAMBOOHR_URL} target="_blank" rel="noopener noreferrer">Open BambooHR ↗</a>
          <button className="btn-sm btn-ghost" onClick={onSeeTeam}>See who's off in your team</button>
        </div>
      </div>
      <button className="btn-sm btn-ghost" style={{ border: "none" }} title="Dismiss" onClick={onDismiss}>✕</button>
    </div>
  );
}

/* ----------------------------- shared calc ----------------------------- */
function isClosure(data: VacationData, s: Date, e: Date) {
  return data.closures.some((c) => overlap(d(c.startDate), d(c.endDate), s, e));
}
function isBusy(data: VacationData, s: Date, e: Date) {
  return data.busyPeriods.some((b) => overlap(d(b.startDate), d(b.endDate), s, e));
}
function holidayNote(data: VacationData, s: Date, e: Date): { type: "closure" | "public"; name: string } | null {
  const c = data.closures.find((x) => overlap(d(x.startDate), d(x.endDate), s, e));
  if (c) return { type: "closure", name: c.name };
  const p = data.publicHolidays.find((x) => overlap(d(x.holidayDate), d(x.holidayDate), s, e));
  if (p) return { type: "public", name: p.name };
  return null;
}
function whoOut(data: VacationData, s: Date, e: Date): string[] {
  const closureOut = isClosure(data, s, e) ? data.members.map((m) => m.name) : [];
  const vacOut = data.members.filter((m) => m.vacations.some((v) => overlap(d(v.start), d(v.end), s, e))).map((m) => m.name);
  return Array.from(new Set([...closureOut, ...vacOut]));
}
function openQuarter(data: VacationData): Quarter | null {
  const today = new Date();
  return data.quarters.find((q) => d(q.deadline) >= today) ?? null;
}

/* ----------------------------- My Vacation ----------------------------- */
function MyVacation({ data, me }: { data: VacationData; me: Member | undefined }) {
  const mine = (me?.vacations ?? []).slice().sort((a, b) => d(a.start).getTime() - d(b.start).getTime());
  const today = new Date();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 16 }} className="vac-grid">
      <div style={card}>
        <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>Your submitted time off <span style={{ color: "var(--soft)", fontWeight: 500 }}>· from BambooHR</span></h2>
        {mine.length === 0 && <div style={{ fontSize: 13, color: "var(--soft)" }}>Nothing logged in this window. Log time off in BambooHR.</div>}
        {mine.map((v, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <span style={swatch(VAC)} />
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{fmtLong(d(v.start))} – {fmtLong(d(v.end))}</span>
            <span style={{ marginLeft: "auto", color: "var(--soft)", fontSize: 12 }}>{d(v.end) < today ? "Taken" : "Upcoming"} · {v.type}</span>
          </div>
        ))}
      </div>
      <div style={card}>
        <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>Quarterly planning windows</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Quarter", "Deadline", "Status"].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 4px", color: "var(--soft)", fontSize: 11, textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
          <tbody>
            {data.quarters.map((q) => {
              const deadline = d(q.deadline);
              const logged = (me?.vacations ?? []).some((v) => overlap(d(v.start), d(v.end), d(q.start), d(q.end)));
              let chip: { cls: string; text: string };
              if (logged) chip = { cls: "free", text: "✓ Logged" };
              else if (today <= deadline) chip = { cls: "vac", text: `⏳ Open — ${daysBetween(today, deadline)} days left` };
              else chip = { cls: "off", text: "⚠ Overdue — nothing logged" };
              return (
                <tr key={q.label} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 4px" }}>{q.label}</td>
                  <td style={{ padding: "8px 4px" }}>{fmtLong(deadline)}</td>
                  <td style={{ padding: "8px 4px" }}><span className={"mini " + chip.cls}>{chip.text}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: "var(--soft)", marginTop: 8 }}>Deadlines: Q2 → Jan 30 · Q3 → Mar 30 · Q4 → Jul 30 · Q1 → Sep 30 (year prior). Late submissions are flagged, not auto-declined.</p>
      </div>
      <div style={{ ...card, gridColumn: "1 / -1" }}>
        <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>Company holidays</h2>
        {data.closures.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
            <span style={swatch(CLOSE)} /><span style={{ fontWeight: 600, fontSize: 13.5 }}>{fmtLong(d(c.startDate))}{c.endDate !== c.startDate ? ` – ${fmtLong(d(c.endDate))}` : ""} — {c.name}</span>
            <span style={{ marginLeft: "auto", color: "var(--soft)", fontSize: 12 }}>Closure · everyone off</span>
          </div>
        ))}
        {data.publicHolidays.map((h) => (
          <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
            <span style={swatch(PUB)} /><span style={{ fontWeight: 600, fontSize: 13.5 }}>{fmtLong(d(h.holidayDate))} — {h.name}</span>
            <span style={{ marginLeft: "auto", color: "var(--soft)", fontSize: 12 }}>Public holiday · coverage: {h.reqTotal} needed</span>
          </div>
        ))}
        {data.closures.length === 0 && data.publicHolidays.length === 0 && <div style={{ fontSize: 13, color: "var(--soft)" }}>No holidays configured — add them in the Holidays &amp; Coverage tab.</div>}
      </div>
    </div>
  );
}

/* ----------------------------- Team View heatmap ----------------------------- */
function TeamView({ data, teamId, setTeamId, meId }: { data: VacationData; teamId: string; setTeamId: (s: string) => void; meId: string }) {
  const WEEKS = 5;
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const [detail, setDetail] = useState<{ start: Date; end: Date } | null>(null);
  const periods = useMemo(() => halfPeriods(anchor, WEEKS), [anchor]);
  const open = openQuarter(data);
  // "Hasn't planned" is only meaningful once BambooHR is connected — otherwise
  // there's no data to plan against and we'd wrongly flag the whole BU.
  const notSubmitted = (m: Member) => data.bambooConfigured && open && !m.vacations.some((v) => overlap(d(v.start), d(v.end), d(open.start), d(open.end)));

  const cellState = (m: Member, s: Date, e: Date): "mandatory" | "vacation" | "not-submitted" | null => {
    if (isClosure(data, s, e)) return "mandatory";
    if (m.vacations.some((v) => overlap(d(v.start), d(v.end), s, e))) return "vacation";
    if (open && s >= d(open.start) && s <= d(open.end) && notSubmitted(m)) return "not-submitted";
    return null;
  };
  const badge = (n: number) => (n >= 4 ? "var(--red)" : n === 3 ? "#ec835a" : n === 2 ? "#fab219" : "var(--soft)");

  // Slack reminder to log vacation — replaces the old mailto nudge.
  const [reminded, setReminded] = useState<Record<string, string>>({});
  const sendReminder = async (m: Member) => {
    setReminded((p) => ({ ...p, [m.id]: "Sending…" }));
    try {
      const r = await api.post<{ ok: boolean; error?: string }>("/vacation/remind", {
        email: m.email,
        name: m.name,
        quarter: open?.label,
        deadline: open ? fmtLong(d(open.deadline)) : undefined,
      });
      setReminded((p) => ({ ...p, [m.id]: r.ok ? "Reminded on Slack ✓" : r.error || "Couldn't send" }));
    } catch (e) {
      setReminded((p) => ({ ...p, [m.id]: e instanceof ApiError ? e.message : "Couldn't send" }));
    }
  };

  return (
    <>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ font: "inherit", fontWeight: 600, padding: "6px 10px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }}>
            <option value="">Whole BU ({data.members.length})</option>
            {data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn-sm btn-ghost" onClick={() => setAnchor(addDays(anchor, -7 * WEEKS))}>‹</button>
            <span style={{ fontWeight: 600, fontSize: 13, minWidth: 170, textAlign: "center" }}>{fmt(periods[0].start)} – {fmt(periods[periods.length - 1].end)}</span>
            <button className="btn-sm btn-ghost" onClick={() => setAnchor(addDays(anchor, 7 * WEEKS))}>›</button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--soft)", marginBottom: 10 }}>Time off is tracked in half-week blocks (Mon–Wed / Thu–Sun).</div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, color: "var(--soft)", marginBottom: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={swatch(VAC)} /> Personal vacation</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={swatch(CLOSE)} /> Closure (everyone off)</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ ...swatch(PUB), borderRadius: "50%" }} /> Public holiday</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ ...swatch("#ccc"), backgroundImage: BUSY_TEXTURE }} /> High-stakes / busy</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: "50%", border: `2px solid ${YOU}` }} /> You</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ ...swatch("#ccc"), background: NOT_SUB_BG }} /> Hasn't planned</span>
        </div>

        <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0 10px", minWidth: 150, fontSize: 12.5 }}>Team member</th>
                  {periods.map((p, i) => {
                    const h = holidayNote(data, p.start, p.end); const b = isBusy(data, p.start, p.end);
                    return (
                      <th key={i} style={{ fontSize: 10.5, color: "var(--soft)", fontWeight: 600, padding: "4px 2px", minWidth: 54, border: "1px solid var(--line)" }}>
                        <div>{fmt(p.start)}</div><div style={{ fontWeight: 700 }}>{p.tag}</div>
                        {h && <div style={{ fontSize: 9, marginTop: 2 }}><span style={{ ...swatch(h.type === "closure" ? CLOSE : PUB), borderRadius: "50%", width: 6, height: 6 }} /> {h.name.split(" (")[0]}</div>}
                        {b && <div style={{ fontSize: 9, fontWeight: 700, color: "#ec835a", marginTop: 1 }}>🔥 busy</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id}>
                    <td style={{ textAlign: "left", padding: "0 10px", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", border: "1px solid var(--line)", color: m.id === meId ? YOU : undefined }}>
                      {m.id === meId && <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", border: `2px solid ${YOU}`, marginRight: 6 }} />}
                      {m.name}{m.id === meId ? " (you)" : ""} <span style={{ fontWeight: 500, color: "var(--soft)", fontSize: 11 }}>· {m.seniority ?? "—"}</span>
                    </td>
                    {periods.map((p, i) => {
                      const st = cellState(m, p.start, p.end); const b = isBusy(data, p.start, p.end);
                      let bg = "transparent";
                      if (st === "mandatory") bg = CLOSE; else if (st === "vacation") bg = VAC;
                      const notSub = st === "not-submitted";
                      return <td key={i} title={st ?? ""} onClick={() => setDetail({ start: p.start, end: p.end })} style={{ cursor: "pointer", border: "1px solid var(--line)", height: 32, background: notSub ? NOT_SUB_BG : bg, backgroundImage: st === "vacation" && b ? BUSY_TEXTURE : undefined }} />;
                    })}
                  </tr>
                ))}
                <tr>
                  <td style={{ padding: "0 10px", fontWeight: 700, fontSize: 12, borderTop: "2px solid var(--line)" }}>Out this half</td>
                  {periods.map((p, i) => {
                    const n = whoOut(data, p.start, p.end).length;
                    return <td key={i} style={{ textAlign: "center", borderTop: "2px solid var(--line)", border: "1px solid var(--line)" }}><span onClick={() => setDetail({ start: p.start, end: p.end })} style={{ cursor: "pointer", display: "inline-block", minWidth: 22, padding: "1px 5px", borderRadius: 999, fontWeight: 700, fontSize: 11.5, color: "#fff", background: badge(n) }}>{n}</span></td>;
                  })}
                </tr>
              </tbody>
            </table>
          </div>

        {detail && (
          <div style={{ marginTop: 12, border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", background: "var(--surface2, var(--surface))", fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{fmtLong(detail.start)} – {fmtLong(detail.end)}</div>
            <div style={{ color: "var(--soft)" }}>
              {whoOut(data, detail.start, detail.end).length} of {data.members.length} out{isClosure(data, detail.start, detail.end) ? " (includes a company closure)" : ""}: {whoOut(data, detail.start, detail.end).join(", ") || "no one"}
            </div>
            {isBusy(data, detail.start, detail.end) && <span style={{ color: "#ec835a", fontWeight: 600, marginTop: 6, display: "block" }}>⚠ Overlaps a high-stakes period — worth double-checking coverage.</span>}
          </div>
        )}
      </div>

      {open && (
        <div style={card}>
          <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>Hasn't planned the open window yet <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {open.label}, due {fmtLong(d(open.deadline))}</span></h2>
          {!data.bambooConfigured ? (
            <div style={{ fontSize: 13, color: "var(--soft)" }}>
              BambooHR isn't connected, so there's no vacation data to check against yet. Connect it in <strong>Settings → Integrations</strong> — until then this can't tell who has or hasn't planned.
            </div>
          ) : (
            <>
              {data.members.filter(notSubmitted).map((m) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13, borderBottom: "1px solid var(--line)" }}>
                  <span style={{ fontWeight: 600, flex: 1 }}>{m.name}</span>
                  <span className="mini off">Nothing logged</span>
                  {reminded[m.id] ? (
                    <span style={{ fontSize: 12, color: "var(--soft)" }}>{reminded[m.id]}</span>
                  ) : (
                    <button className="btn-sm btn-ghost" onClick={() => sendReminder(m)}>Send reminder</button>
                  )}
                </div>
              ))}
              {data.members.filter(notSubmitted).length === 0 && <div style={{ fontSize: 13, color: "var(--soft)" }}>Everyone has logged something for {open.label}. 🎉</div>}
              <p style={{ fontSize: 12, color: "var(--soft)", marginTop: 8 }}>Owner/PL view — surfaces gaps before the deadline instead of after.</p>
            </>
          )}
        </div>
      )}
    </>
  );
}

/* ----------------------------- Plan My Trip ----------------------------- */
/* ----------------------------- Book time off (BambooHR write) ----------------------------- */
function BookTimeOff({ data, meEmail }: { data: VacationData; meEmail: string }) {
  const [types, setTypes] = useState<{ id: string; name: string; unit: string }[]>([]);
  const [typesErr, setTypesErr] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [typeId, setTypeId] = useState("");
  const [amount, setAmount] = useState("1"); // per-day: days (1 / 0.5) or hours
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ ok: boolean; error?: string; types: { id: string; name: string; unit: string }[] }>("/vacation/leave-types")
      .then((r) => { if (r.ok) { setTypes(r.types); if (r.types[0]) setTypeId(r.types[0].id); } else setTypesErr(r.error || "Couldn't load leave types"); })
      .catch((e) => setTypesErr(e instanceof ApiError ? e.message : "Couldn't load leave types"));
  }, []);

  const selUnit = types.find((t) => t.id === typeId)?.unit || "days";
  // Default the per-day amount whenever the selected type's unit changes.
  useEffect(() => { setAmount(selUnit === "hours" ? "8" : "1"); }, [selUnit]);
  const valid = !!(start && end && end >= start && typeId && Number(amount) > 0);
  // Capacity signal for the chosen range (excludes me).
  const overlapNames = valid ? data.members.filter((m) => m.email.toLowerCase() !== meEmail.toLowerCase() && m.vacations.some((v) => overlap(d(v.start), d(v.end), d(start), d(end)))).map((m) => m.name) : [];
  const busyHit = valid ? data.busyPeriods.find((b) => overlap(d(b.startDate), d(b.endDate), d(start), d(end))) : undefined;

  const submit = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api.post("/vacation/request", { start, end, timeOffTypeId: typeId, unit: selUnit, amount, note });
      setMsg("Request submitted to BambooHR — it's now pending approval. It'll appear here once BambooHR reflects it.");
      setConfirming(false); setNote("");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not submit the request"); }
    finally { setBusy(false); }
  };

  const inp: CSSProperties = { font: "inherit", padding: "6px 8px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };

  return (
    <div style={card}>
      <h2 style={{ fontSize: 14, margin: "0 0 4px" }}>Request time off <span style={{ color: "var(--soft)", fontWeight: 500 }}>· books straight into BambooHR</span></h2>
      <p style={{ fontSize: 12, color: "var(--soft)", margin: "0 0 12px" }}>Submits a request for your own record as “pending” — your manager approves it in the normal BambooHR flow.</p>
      {!data.bambooConfigured || typesErr ? (
        <div style={{ fontSize: 13, color: "var(--soft)" }}>{typesErr ?? "BambooHR isn't connected — booking is unavailable."}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12 }}>From<br /><input type="date" value={start} onChange={(e) => { setStart(e.target.value); setConfirming(false); }} style={inp} /></label>
            <label style={{ fontSize: 12 }}>To<br /><input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setConfirming(false); }} style={inp} /></label>
            <label style={{ fontSize: 12 }}>Type<br /><select value={typeId} onChange={(e) => { setTypeId(e.target.value); setConfirming(false); }} style={inp}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label style={{ fontSize: 12 }}>Amount / day<br />
              {selUnit === "hours" ? (
                <input type="number" min={0.5} max={24} step={0.5} value={amount} onChange={(e) => { setAmount(e.target.value); setConfirming(false); }} style={{ ...inp, width: 96 }} title="Hours per day" />
              ) : (
                <select value={amount} onChange={(e) => { setAmount(e.target.value); setConfirming(false); }} style={inp}>
                  <option value="1">Full day</option>
                  <option value="0.5">Half day</option>
                </select>
              )}
            </label>
            <label style={{ fontSize: 12, flex: 1, minWidth: 160 }}>Note (optional)<br /><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. family holiday" style={{ ...inp, width: "100%" }} /></label>
          </div>

          {valid && (overlapNames.length >= 2 || busyHit) && (
            <div style={{ marginTop: 12, border: "1px solid #ec835a", background: "rgba(236,131,90,0.08)", borderRadius: 9, padding: "10px 12px", fontSize: 12.5 }}>
              {overlapNames.length >= 2 && <div>⚠ <strong>{overlapNames.length} teammate(s) already off</strong> then ({overlapNames.slice(0, 5).join(", ")}{overlapNames.length > 5 ? "…" : ""}) — this may push the week below coverage.</div>}
              {busyHit && <div style={{ marginTop: overlapNames.length >= 2 ? 4 : 0 }}>⚠ Overlaps “{busyHit.label}”, a high-stakes period.</div>}
              <div style={{ color: "var(--soft)", marginTop: 4 }}>You can still submit — your PL/manager sees it before approving.</div>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            {!confirming ? (
              <button className="btn-sm btn-pl" disabled={busy || !valid} onClick={() => { setErr(null); setMsg(null); setConfirming(true); }}>Request time off</button>
            ) : (
              <>
                <span style={{ fontSize: 13 }}>Submit {start} → {end} · {types.find((t) => t.id === typeId)?.name} · {selUnit === "hours" ? `${amount}h/day` : amount === "0.5" ? "half day" : "full day"}?</span>
                <button className="btn-sm btn-pl" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Confirm"}</button>
                <button className="btn-sm btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
              </>
            )}
          </div>
          {msg && <div style={{ fontSize: 12.5, color: "var(--green)", marginTop: 8 }}>{msg}</div>}
          {err && <div className="err-line" style={{ marginTop: 8 }}>{err}</div>}
        </>
      )}
    </div>
  );
}

function PlanTrip({ data, meEmail }: { data: VacationData; meEmail: string }) {
  const [from, setFrom] = useState(data.window.from);
  const [to, setTo] = useState(addDays(d(data.window.from), 4).toISOString().slice(0, 10));
  const [range, setRange] = useState<{ from: string; to: string }>({ from, to });
  const fromD = d(range.from), toD = d(range.to);
  const out = data.members.filter((m) => m.email.toLowerCase() !== meEmail.toLowerCase() && m.vacations.some((v) => overlap(d(v.start), d(v.end), fromD, toD))).map((m) => m.name);
  const closureHit = data.closures.find((c) => overlap(d(c.startDate), d(c.endDate), fromD, toD));
  const busyHit = data.busyPeriods.find((b) => overlap(d(b.startDate), d(b.endDate), fromD, toD));
  const n = out.length;
  const label = n >= 4 ? "Heavy overlap" : n === 3 ? "Getting crowded" : n === 2 ? "A couple of overlaps" : "Looks quiet";

  const best = useMemo(() => {
    return halfPeriods(startOfWeek(new Date()), 6)
      .map((p) => ({ p, count: isClosure(data, p.start, p.end) ? -1 : whoOut(data, p.start, p.end).length }))
      .filter((x) => x.count >= 0)
      .sort((a, b) => a.count - b.count)
      .slice(0, 6);
  }, [data]);
  const max = Math.max(...best.map((b) => b.count), 1);

  return (
    <>
      <BookTimeOff data={data} meEmail={meEmail} />
      <div style={card}>
        <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>Who's off in my team, when?</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
          <label style={{ fontSize: 12 }}>From<br /><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ font: "inherit", padding: "6px", borderRadius: 7, border: "1px solid var(--line)" }} /></label>
          <label style={{ fontSize: 12 }}>To<br /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ font: "inherit", padding: "6px", borderRadius: 7, border: "1px solid var(--line)" }} /></label>
          <button className="btn-sm btn-pl" onClick={() => setRange({ from, to })}>Check overlap</button>
        </div>
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{label} — {n} teammate{n === 1 ? "" : "s"} already off {fmtLong(fromD)}–{fmtLong(toD)}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{out.length ? out.map((nm) => <span key={nm} style={{ background: "rgba(42,120,214,0.1)", color: VAC, fontWeight: 600, fontSize: 12.5, padding: "3px 9px", borderRadius: 999 }}>{nm}</span>) : <span style={{ color: "var(--soft)", fontSize: 13 }}>No one else out.</span>}</div>
          {closureHit && <div style={{ fontSize: 12.5, color: "var(--soft)", marginTop: 8 }}>Includes a company closure ({closureHit.name}).</div>}
          {busyHit && <div style={{ fontSize: 12.5, color: "#ec835a", fontWeight: 600, marginTop: 6 }}>⚠ Overlaps "{busyHit.label}" — a high-stakes period. Flag with your PL before submitting.</div>}
        </div>
      </div>
      <div style={card}>
        <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>Lower-overlap half-weeks nearby <span style={{ color: "var(--soft)", fontWeight: 500 }}>· next 6 weeks</span></h2>
        {best.map((b, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontSize: 13 }}>
            <div style={{ width: 160, fontWeight: 600 }}>{fmt(b.p.start)} ({b.p.tag})</div>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}><div style={{ height: "100%", width: `${(b.count / max) * 100 || 4}%`, background: b.count >= 3 ? "#ec835a" : b.count === 2 ? "#fab219" : "var(--green)" }} /></div>
            <div style={{ width: 60, textAlign: "right", color: "var(--soft)", fontSize: 12 }}>{b.count} out</div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ----------------------------- Admin: Holidays & Coverage ----------------------------- */
function AdminPanel({ data, busy, mutate }: { data: VacationData; busy: boolean; mutate: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [cName, setCName] = useState(""); const [cStart, setCStart] = useState(""); const [cEnd, setCEnd] = useState("");
  const [bLabel, setBLabel] = useState(""); const [bStart, setBStart] = useState(""); const [bEnd, setBEnd] = useState("");
  const [hName, setHName] = useState(""); const [hDate, setHDate] = useState("");
  const seniorityOf = (id: string) => data.members.find((m) => m.id === id)?.seniority ?? null;

  const coverageStatus = (h: PublicHoliday) => {
    const counts = { Senior: 0, Mid: 0, Junior: 0 } as Record<string, number>;
    h.coverage.forEach((pid) => { const s = seniorityOf(pid); if (s) counts[s] = (counts[s] || 0) + 1; });
    const short: string[] = [];
    if (h.coverage.length < h.reqTotal) short.push(`${h.reqTotal - h.coverage.length} short overall`);
    ([["Senior", h.reqSenior], ["Mid", h.reqMid], ["Junior", h.reqJunior]] as const).forEach(([r, need]) => {
      if ((counts[r] || 0) < need) short.push(`${need - (counts[r] || 0)} short on ${r}`);
    });
    return short;
  };

  return (
    <>
      <Diagnostics />
      <div style={card}>
        <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>Company closures <span style={{ color: "var(--soft)", fontWeight: 500 }}>· everyone off</span></h2>
        {data.closures.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
            <span style={swatch(CLOSE)} /><span style={{ fontWeight: 600 }}>{c.name}</span>
            <span style={{ color: "var(--soft)", fontSize: 12 }}>{fmtLong(d(c.startDate))}{c.endDate !== c.startDate ? ` – ${fmtLong(d(c.endDate))}` : ""}</span>
            <button className="btn-sm btn-ghost" style={{ marginLeft: "auto", color: "var(--red)" }} disabled={busy} onClick={() => mutate(() => api.del(`/vacation/closures/${c.id}`))}>Delete</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
          <input placeholder="Closure name" value={cName} onChange={(e) => setCName(e.target.value)} style={inp} />
          <input type="date" value={cStart} onChange={(e) => setCStart(e.target.value)} style={inp} />
          <input type="date" value={cEnd} onChange={(e) => setCEnd(e.target.value)} style={inp} />
          <button className="btn-sm btn-pl" disabled={busy || !cName.trim() || !cStart || !cEnd} onClick={() => mutate(async () => { await api.post("/vacation/closures", { name: cName.trim(), startDate: cStart, endDate: cEnd }); setCName(""); setCStart(""); setCEnd(""); })}>＋ Add closure</button>
        </div>
      </div>

      <div style={card}>
        <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>Public holidays — coverage required</h2>
        {data.publicHolidays.map((h) => {
          const short = coverageStatus(h);
          return (
            <div key={h.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                <div><div style={{ fontWeight: 700 }}>{h.name}</div><div style={{ color: "var(--soft)", fontSize: 12 }}>{fmtLong(d(h.holidayDate))}{h.teamId ? ` · ${data.teams.find((t) => t.id === h.teamId)?.name ?? ""}` : " · whole BU"}</div></div>
                <span className={"mini " + (short.length ? "off" : "free")}>{short.length ? `⚠ ${short.join(", ")}` : "✓ Coverage met"}</span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                {([["Total", "reqTotal"], ["Senior", "reqSenior"], ["Mid", "reqMid"], ["Junior", "reqJunior"]] as const).map(([lbl, key]) => (
                  <label key={key} style={{ fontSize: 11 }}>{lbl}<br /><input type="number" min={0} defaultValue={h[key]} disabled={busy} style={{ ...inp, width: 64 }} onBlur={(e) => { const v = Math.max(0, parseInt(e.target.value, 10) || 0); if (v !== h[key]) mutate(() => api.patch(`/vacation/public-holidays/${h.id}`, { reqTotal: key === "reqTotal" ? v : h.reqTotal, reqSenior: key === "reqSenior" ? v : h.reqSenior, reqMid: key === "reqMid" ? v : h.reqMid, reqJunior: key === "reqJunior" ? v : h.reqJunior })); }} /></label>
                ))}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--soft)", marginBottom: 4 }}>Assigned to cover</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {data.members.map((m) => {
                  const on = h.coverage.includes(m.id);
                  return <button key={m.id} className={"btn-sm " + (on ? "btn-pl" : "btn-ghost")} disabled={busy} onClick={() => mutate(() => api.patch(`/vacation/public-holidays/${h.id}/coverage`, { personId: m.id, assigned: !on }))}>{on ? "✓ " : ""}{m.name}{m.seniority ? ` · ${m.seniority}` : ""}</button>;
                })}
              </div>
              <button className="btn-sm btn-ghost" style={{ color: "var(--red)", marginTop: 8 }} disabled={busy} onClick={() => mutate(() => api.del(`/vacation/public-holidays/${h.id}`))}>Delete holiday</button>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 4 }}>
          <input placeholder="Holiday name" value={hName} onChange={(e) => setHName(e.target.value)} style={inp} />
          <input type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} style={inp} />
          <button className="btn-sm btn-pl" disabled={busy || !hName.trim() || !hDate} onClick={() => mutate(async () => { await api.post("/vacation/public-holidays", { name: hName.trim(), holidayDate: hDate, reqTotal: 1 }); setHName(""); setHDate(""); })}>＋ Add public holiday</button>
        </div>
        <p style={{ fontSize: 12, color: "var(--soft)", marginTop: 8 }}>Coverage requirements use each person's seniority (set it in Settings → User management). Cap Tracker flags a shortfall the moment the roster falls short.</p>
      </div>

      <div style={card}>
        <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>High-stakes / busy periods</h2>
        {data.busyPeriods.map((b) => (
          <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
            <span style={{ fontSize: 13 }}>🔥</span><span style={{ fontWeight: 600 }}>{b.label}</span>
            <span style={{ color: "var(--soft)", fontSize: 12 }}>{fmtLong(d(b.startDate))} – {fmtLong(d(b.endDate))}</span>
            <button className="btn-sm btn-ghost" style={{ marginLeft: "auto", color: "var(--red)" }} disabled={busy} onClick={() => mutate(() => api.del(`/vacation/busy-periods/${b.id}`))}>Delete</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
          <input placeholder="Label (e.g. Client Delivery Sprint)" value={bLabel} onChange={(e) => setBLabel(e.target.value)} style={inp} />
          <input type="date" value={bStart} onChange={(e) => setBStart(e.target.value)} style={inp} />
          <input type="date" value={bEnd} onChange={(e) => setBEnd(e.target.value)} style={inp} />
          <button className="btn-sm btn-pl" disabled={busy || !bLabel.trim() || !bStart || !bEnd} onClick={() => mutate(async () => { await api.post("/vacation/busy-periods", { label: bLabel.trim(), startDate: bStart, endDate: bEnd }); setBLabel(""); setBStart(""); setBEnd(""); })}>＋ Add busy period</button>
        </div>
      </div>
    </>
  );
}

const inp: CSSProperties = { font: "inherit", fontSize: 13, padding: "7px 9px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
