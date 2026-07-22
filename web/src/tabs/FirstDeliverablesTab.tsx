import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Assignment, Project } from "../api/types";
import { barColor, initials } from "../lib/format";
import { fmtElapsed, timerClass } from "../lib/time";
import { useSort } from "../lib/useSort";
import { useViewport } from "../lib/useViewport";
import { useApp } from "../state/AppContext";
import type { Scope } from "../components/Header";

/**
 * §8 (domain change 8) — this tab shows deliverers still on First
 * Deliverable, not projects: stage is per-assignment now, so two people on
 * the same project can be at different stages, and only the ones still on
 * First Deliverable belong here.
 */
interface Row {
  project: Project;
  assignment: Assignment;
  elapsed: number;
}

// Stale-while-revalidate: paint the last BU snapshot instantly on tab switch.
let fdCache: Row[] | null = null;

type SortKey = "deliverer" | "client" | "pl" | "elapsed" | "progress";

function SortHeader({
  label,
  active,
  dir,
  onClick,
  numeric,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  numeric?: boolean;
}) {
  return (
    <th className={numeric ? "num" : undefined}>
      <button onClick={onClick}>
        {label} {active && (dir === "asc" ? "↑" : "↓")}
      </button>
    </th>
  );
}

export default function FirstDeliverablesTab({
  scope,
  reloadTick,
  onCount,
}: {
  scope: Scope;
  reloadTick: number;
  onCount: (n: number) => void;
}) {
  const { actor, people, nameOf, nowMs } = useApp();
  const { isDesktop } = useViewport();
  const [rows, setRows] = useState<Row[] | null>(fdCache);

  useEffect(() => {
    const load = async () => {
      // BU-wide by design (2026-07-21): this board is the org's first-
      // deliverable pulse — EVERY individual currently in First Deliverable
      // across all teams, regardless of the sidebar scope toggle. TWO
      // requests total via GET /projects/board (the old per-project detail
      // fan-out over the whole BU is what crawled).
      const [leading, delivering] = await Promise.all([
        api.get<{ project: Project; assignments: Assignment[] }[]>(
          `/projects/board?role=leading&scope=team&teamId=all&status=active`
        ),
        api.get<{ project: Project; assignments: Assignment[] }[]>(
          `/projects/board?role=delivering&scope=team&teamId=all&status=active`
        ),
      ]);
      const byId = new Map<string, { project: Project; assignments: Assignment[] }>();
      for (const it of [...leading, ...delivering]) byId.set(it.project.id, it);

      const now = Date.now();
      const built: Row[] = [];
      for (const d of byId.values()) {
        for (const a of d.assignments) {
          if (a.stage !== "First Deliverable") continue;
          // "Invisible competition" — a ghost never appears on this board: it's
          // not a real person to chase, so it must not inflate the count or the
          // "past 30 min — ping due" tally (same roll-up exclusion as the cards).
          if (a.isGhost) continue;
          built.push({ project: d.project, assignment: a, elapsed: now - new Date(a.stageEnteredAt).getTime() });
        }
      }
      built.sort((a, b) => b.elapsed - a.elapsed);
      fdCache = built;
      setRows(built);
      onCount(built.length);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, reloadTick]);

  const { sorted, sortKey, sortDir, toggle } = useSort<Row, SortKey>(
    rows ?? [],
    {
      deliverer: (r) => nameOf(r.assignment.delivererId),
      client: (r) => r.project.client,
      pl: (r) => nameOf(r.project.plId),
      elapsed: (r) => r.elapsed,
      progress: (r) => (r.assignment.goal ? (r.assignment.delivered + r.assignment.customDelivered) / r.assignment.goal : 0),
    },
    "elapsed",
    "desc"
  );

  if (!rows) return <div className="empty">Loading…</div>;

  const overdue = rows.filter((r) => r.elapsed / 60000 >= 30).length;
  const scopeNote = "Entire BU — every team, every deliverer currently in First Deliverable";
  const footNote = "Sorted by time in first deliverable. At 30 min with no update, a ping would go to the PL and deliverer (phase two).";

  if (isDesktop) {
    return (
      <>
        <div className="scope-note">{scopeNote}</div>
        {overdue > 0 && (
          <div className="review-strip">
            <span>⏱</span>
            <div style={{ flex: 1 }}>
              <b>{overdue}</b> past 30 min with no update — ping due
            </div>
          </div>
        )}
        <div className="section-lbl">
          Deliverers still on First Deliverable <span className="count">{rows.length}</span>
        </div>
        {rows.length === 0 && (
          <div className="empty">
            <b>Nobody in First Deliverable</b>Deliverers appear here the moment they're staffed.
          </div>
        )}
        {rows.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <SortHeader label="Deliverer" active={sortKey === "deliverer"} dir={sortDir} onClick={() => toggle("deliverer")} />
                <SortHeader label="Client / Topic" active={sortKey === "client"} dir={sortDir} onClick={() => toggle("client")} />
                <SortHeader label="PL" active={sortKey === "pl"} dir={sortDir} onClick={() => toggle("pl")} />
                <SortHeader label="Elapsed" active={sortKey === "elapsed"} dir={sortDir} onClick={() => toggle("elapsed")} />
                <SortHeader label="Progress" active={sortKey === "progress"} dir={sortDir} onClick={() => toggle("progress")} numeric />
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ project: p, assignment: a }) => {
                const elapsed = nowMs - new Date(a.stageEnteredAt).getTime();
                const dAll = a.delivered + a.customDelivered;
                return (
                  <tr key={a.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="avatar dl">{initials(nameOf(a.delivererId))}</div>
                        {nameOf(a.delivererId)}
                      </div>
                    </td>
                    <td>
                      <a href={p.projectLink} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, color: "var(--ink)" }}>
                        {p.client}
                      </a>
                      <div style={{ fontSize: 12, color: "var(--soft)" }}>{p.topic}</div>
                    </td>
                    <td>{nameOf(p.plId)}</td>
                    <td>
                      <span className={"chip timer " + timerClass(elapsed)}>⏱ {fmtElapsed(elapsed)}</span>
                      {elapsed / 60000 >= 30 && (
                        <div style={{ fontSize: 10, color: "#A82F2F", fontWeight: 700, marginTop: 4 }}>Ping due</div>
                      )}
                    </td>
                    <td className="num">
                      {dAll}/{a.goal}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="foot-note">{footNote}</p>
      </>
    );
  }

  return (
    <>
      <div className="scope-note">{scopeNote}</div>
      {overdue > 0 && (
        <div className="review-strip">
          <span>⏱</span>
          <div style={{ flex: 1 }}>
            <b>{overdue}</b> past 30 min with no update — ping due
          </div>
        </div>
      )}
      <div className="section-lbl">
        Deliverers still on first deliverable <span className="count">{rows.length}</span>
      </div>
      {rows.length === 0 && (
        <div className="empty">
          <b>Nobody in first deliverable</b>Deliverers appear here the moment they're staffed.
        </div>
      )}
      {rows.map(({ project: p, assignment: a }) => {
        const elapsed = nowMs - new Date(a.stageEnteredAt).getTime();
        const dAll = a.delivered + a.customDelivered;
        const pct = a.goal ? Math.min(100, Math.round((dAll / a.goal) * 100)) : 0;
        return (
          <div key={a.id} className="card">
            <div className="card-top">
              <div>
                <div className="client">{nameOf(a.delivererId)}</div>
                <div className="topic">
                  <a href={p.projectLink} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                    {p.client}
                  </a>{" "}
                  · {p.topic}
                </div>
              </div>
              <div className={"chip timer " + timerClass(elapsed)} style={{ fontSize: 14, fontWeight: 700 }}>
                ⏱ {fmtElapsed(elapsed)}
              </div>
            </div>
            <div className="meta">
              <div className="chip">PL {nameOf(p.plId)}</div>
              <div className="chip">{p.expertPool}</div>
              {elapsed / 60000 >= 30 && (
                <div className="chip" style={{ background: "var(--red-bg)", color: "#A82F2F" }}>
                  30m+ · Ping due
                </div>
              )}
            </div>
            <div className="progress" style={{ paddingTop: 10 }}>
              <div className="progress-top">
                <span className="progress-num">
                  {dAll}
                  <small> / {a.goal} goal</small>
                </span>
              </div>
              <div className="bar">
                <span style={{ width: pct + "%", background: barColor(pct) }} />
              </div>
            </div>
          </div>
        );
      })}
      <p className="foot-note">{footNote}</p>
    </>
  );
}
