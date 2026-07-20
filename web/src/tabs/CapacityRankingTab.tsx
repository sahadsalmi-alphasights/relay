import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { CapacityRankRow } from "../api/types";
import { initials } from "../lib/format";
import { useSort } from "../lib/useSort";
import { useViewport } from "../lib/useViewport";
import { useApp } from "../state/AppContext";

type SortKey = "name" | "practice" | "team" | "load";

function StatusChip({ row }: { row: CapacityRankRow }) {
  if (!row.eligible) return <span className="mini off">Off</span>;
  return row.free ? <span className="mini free">Free</span> : <span className="mini busy">Busy</span>;
}

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

/**
 * "Invisible competition" — the Ghost Ranking dashboard is this SAME
 * component with `ghostOnly` set, not a parallel implementation: same query
 * (GET /capacity-ranking, just with ?ghost=true), same markup, only the
 * fetch URL and a couple of copy strings differ.
 */
export default function CapacityRankingTab({ reloadTick, ghostOnly }: { reloadTick: number; ghostOnly?: boolean }) {
  const { nameOf, practiceOf, personById, teamNameOf, demoHour } = useApp();
  const { isDesktop } = useViewport();
  const [rows, setRows] = useState<CapacityRankRow[] | null>(null);

  // Refetch on demoHour too — load is server-computed, so scrubbing the demo
  // clock while sitting on this tab must re-request it, not just relabel the
  // clock in the header (the other half of bugs 1+2).
  useEffect(() => {
    api.get<CapacityRankRow[]>(`/capacity-ranking${ghostOnly ? "?ghost=true" : ""}`).then(setRows);
  }, [reloadTick, demoHour, ghostOnly]);

  const { sorted, sortKey, sortDir, toggle } = useSort<CapacityRankRow, SortKey>(
    rows ?? [],
    {
      name: (r) => nameOf(r.personId),
      practice: (r) => practiceOf(r.personId),
      team: (r) => teamNameOf(personById(r.personId)?.teamId ?? null),
      load: (r) => r.load,
    },
    "load"
  );

  if (!rows) return <div className="empty">Loading…</div>;

  const note = ghostOnly
    ? "Ghost deliverers only — everyone across all teams, org-wide, regardless of the scope toggle."
    : "Everyone across all teams — capacity ranking is always org-wide, regardless of the scope toggle.";
  const footNote =
    "Load is the ranking signal: remaining profiles × stage weight × expert-pool weight for the current Dubai hour. Lowest load is staffed next. Sick / on vacation / offline people are not listed at all.";
  const sectionLabel = ghostOnly ? "Ghost ranking" : "First up now — lowest load leads";

  if (isDesktop) {
    return (
      <>
        <div className="scope-note">{note}</div>
        <div className="section-lbl">
          {sectionLabel} <span className="count">{rows.length}</span>
        </div>
        {rows.length === 0 && <div className="empty">{ghostOnly ? "No ghosts online." : "No one online."}</div>}
        {rows.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <SortHeader label="Name" active={sortKey === "name"} dir={sortDir} onClick={() => toggle("name")} />
                <SortHeader label="Practice" active={sortKey === "practice"} dir={sortDir} onClick={() => toggle("practice")} />
                <SortHeader label="Team" active={sortKey === "team"} dir={sortDir} onClick={() => toggle("team")} />
                <th>Status</th>
                <SortHeader label="Load" active={sortKey === "load"} dir={sortDir} onClick={() => toggle("load")} numeric />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const person = personById(r.personId);
                return (
                  <tr key={r.personId}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="avatar">{initials(nameOf(r.personId))}</div>
                        {nameOf(r.personId)}
                      </div>
                    </td>
                    <td>{practiceOf(r.personId) || "—"}</td>
                    <td>{teamNameOf(person?.teamId ?? null).replace("Team_", "") || "—"}</td>
                    <td>
                      <StatusChip row={r} />
                    </td>
                    <td className="num">{r.load.toFixed(1)}</td>
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
      <div className="scope-note">{note}</div>
      <div className="section-lbl">
        {sectionLabel} <span className="count">{rows.length}</span>
      </div>
      {rows.length === 0 && <div className="empty">{ghostOnly ? "No ghosts online." : "No one online."}</div>}
      {rows.map((r, i) => {
        const person = personById(r.personId);
        return (
          <div key={r.personId} className={"rank-row " + (i < 2 ? "top" : "")}>
            <div className="rank-num">{i + 1}</div>
            <div className="avatar">{initials(nameOf(r.personId))}</div>
            <div className="rank-body">
              <div className="rank-name">{nameOf(r.personId)}</div>
              <div className="rank-sub">
                <span className="mini prac">{practiceOf(r.personId) || "—"}</span>
                <span className="mini team">{teamNameOf(person?.teamId ?? null).replace("Team_", "") || "—"}</span>
                <StatusChip row={r} />
              </div>
            </div>
            <div className="rank-load">
              <b>{r.load.toFixed(1)}</b>
              <small>Load</small>
            </div>
          </div>
        );
      })}
      <p className="foot-note">{footNote}</p>
    </>
  );
}
