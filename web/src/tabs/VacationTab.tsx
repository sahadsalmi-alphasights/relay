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
  const [sub, setSub] = useState<Sub>("mine");
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

      {sub === "mine" && <MyVacation data={data} me={me} />}
      {sub === "team" && <TeamView data={data} teamId={teamId} setTeamId={setTeamId} meId={actor.id} />}
      {sub === "plan" && <PlanTrip data={data} meEmail={data.me.email} />}
      {sub === "admin" && <AdminPanel data={data} busy={busy} mutate={mutate} />}
    </div>
  );
}

/* ----------------------------- Diagnostics (owner test buttons) ----------------------------- */
function Diagnostics() {
  const CHECKS = [
    { key: "connection", label: "BambooHR connection", hint: "Can we reach the employee directory?" },
    { key: "timeoff", label: "Time-off fetch", hint: "Approved time-off in the sync window." },
    { key: "holidays", label: "Public holidays", hint: "Read the office's public holidays from BambooHR (next 12 months)." },
    { key: "matching", label: "People matching", hint: "Do BambooHR emails match CapTracker people?" },
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
      setResults((p) => ({ ...p, [key]: { ok, text } }));
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
