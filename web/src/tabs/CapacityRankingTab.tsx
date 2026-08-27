import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { CapacityRankRow, DeliveryCard } from "../api/types";
import { initials, stageLabel } from "../lib/format";
import { lunchLabel, lunchTiming } from "../lib/lunch";
import { useSort } from "../lib/useSort";
import { useViewport } from "../lib/useViewport";
import { useApp } from "../state/AppContext";
import { Icon } from "../components/Icon";

type SortKey = "name" | "team" | "load";

const STAGE_CLASS: Record<string, string> = {
  "First Deliverable": "fd",
  "Second Deliverable": "sd",
  "Hail Mary": "hm",
  Selling: "se",
};

function StatusChip({ row }: { row: CapacityRankRow }) {
  // "Out to Lunch" — named, in red, rather than the generic "Off": the
  // ranking should say WHY someone isn't first up when the reason is a
  // self-serve toggle they'll flip back within the hour.
  if (row.lunch) return <span className="mini off">Lunch</span>;
  // Sunday: not on today's rota → offline for the day.
  if (row.sundayOff) return <span className="mini off">Off · Sunday</span>;
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
        {label} {active && <Icon name={dir === "asc" ? "arrow-up" : "arrow-down"} size={12} />}
      </button>
    </th>
  );
}

/**
 * Delivery-card panel — opens from a ranking row. Leads with availability
 * (lunch timer / Free / Busy — the "can I give them work now?" answer), then
 * breaks the one Load number into the assignments behind it. Read-only; the
 * breakdown comes from GET /people/:id/delivery-card and every contribution
 * sums to the row's Load.
 */
function DeliveryPanel({ row, rank, total, onClose }: { row: CapacityRankRow; rank: number; total: number; onClose: () => void }) {
  const { nameOf, personById, teamNameOf, nowMs } = useApp();
  const [card, setCard] = useState<DeliveryCard | null>(null);

  useEffect(() => {
    setCard(null);
    api.get<DeliveryCard>(`/people/${row.personId}/delivery-card`).then(setCard);
  }, [row.personId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const team = teamNameOf(personById(row.personId)?.teamId ?? null).replace("Team_", "");
  const t = card ? lunchTiming(card.outToLunchSince, card.lunchAutoOffMin, nowMs) : null;
  const meterPct = t ? Math.max(4, Math.min(100, Math.round(((t.elapsedMin) / (t.elapsedMin + Math.max(t.remainingMin, 0) || 1)) * 100))) : 0;

  return (
    <div className="dp-scrim" onClick={onClose}>
      <aside className="dp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dp-top">
          <div className="dp-id">
            <div className="avatar">{initials(nameOf(row.personId))}</div>
            <div className="dp-nm">
              <div className="dp-name">{nameOf(row.personId)}</div>
              <div className="dp-sub">{team || "—"}{card?.practiceArea ? ` · ${card.practiceArea}` : ""}</div>
            </div>
            <button className="dp-x" aria-label="Close" onClick={onClose}><Icon name="x" size={16} /></button>
          </div>

          {/* Status first — the allocation-relevant answer up top. */}
          {row.lunch && t ? (
            <div className="dp-lunch">
              <div className="dp-lunch-r"><span className="mini off">Lunch</span><b>{lunchLabel(t)}</b></div>
              <div className="dp-meter"><i style={{ width: `${meterPct}%` }} /></div>
            </div>
          ) : (
            <div className="dp-avail">
              <StatusChip row={row} />
              <span>{row.sundayOff ? "Off for today's Sunday rota" : !row.eligible ? "Offline right now" : row.free ? "Available — at or below median load" : "Available, but above median load"}</span>
            </div>
          )}

          <div className="dp-stats">
            <div className="dp-stat"><div className="k">Load</div><div className="v">{row.load.toFixed(1)}</div></div>
            <div className="dp-stat"><div className="k">Rank</div><div className="v">{rank}<small> / {total}</small></div></div>
            <div className="dp-stat"><div className="k">Profiles left</div><div className="v">{card ? card.rawRemaining : "—"}</div></div>
          </div>
        </div>

        <div className="dp-sec">Capacity taken up by</div>
        {!card ? (
          <div className="empty" style={{ margin: 16 }}>Loading…</div>
        ) : card.assignments.length === 0 ? (
          <div className="empty" style={{ margin: 16 }}>No active assignments — fully open to new work.</div>
        ) : (
          <div className="dp-cards">
            {card.assignments.map((a) => {
              const pct = card.load > 0 ? Math.round((a.loadContribution / card.load) * 100) : 0;
              const zero = a.loadContribution === 0;
              return (
                <div key={a.assignmentId} className={"dp-card" + (zero ? " zero" : "")}>
                  <div className="dp-card-r1">
                    <span className="dp-client">{a.client}</span>
                    <span className={"dp-stg " + (STAGE_CLASS[a.stage] ?? "se")}>{stageLabel(a.stage)}</span>
                    <span className="dp-lc">{a.loadContribution.toFixed(1)}</span>
                  </div>
                  <div className="dp-card-r2">
                    <span className="dp-angle">{a.angleName}</span>
                    <span className="dp-bar"><i style={{ width: `${zero ? 0 : Math.max(6, pct)}%` }} /></span>
                    <span className="dp-rem">{zero ? "no load" : `${a.remaining} left`}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {card && (
          <div className="dp-foot">
            {card.assignments.filter((a) => a.loadContribution > 0).length} active · {card.rawRemaining} profiles remaining · <b>load {card.load.toFixed(1)}</b>
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * "Invisible competition" — the Ghost Ranking dashboard is this SAME
 * component with `ghostOnly` set, not a parallel implementation: same query
 * (GET /capacity-ranking, just with ?ghost=true), same markup, only the
 * fetch URL and a couple of copy strings differ.
 */
export default function CapacityRankingTab({ reloadTick, ghostOnly }: { reloadTick: number; ghostOnly?: boolean }) {
  const { nameOf, personById, teamNameOf, demoHour } = useApp();
  const { isDesktop } = useViewport();
  const [rows, setRows] = useState<CapacityRankRow[] | null>(null);
  // Which row's delivery-card panel is open (null = none). Rank is the row's
  // position in the list the user is looking at, shown in the panel header.
  const [sel, setSel] = useState<{ row: CapacityRankRow; rank: number } | null>(null);

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
                <SortHeader label="Team" active={sortKey === "team"} dir={sortDir} onClick={() => toggle("team")} />
                <th>Status</th>
                <SortHeader label="Load" active={sortKey === "load"} dir={sortDir} onClick={() => toggle("load")} numeric />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const person = personById(r.personId);
                return (
                  <tr
                    key={r.personId}
                    className={"rank-clickable" + (sel?.row.personId === r.personId ? " rank-open" : "")}
                    onClick={() => setSel({ row: r, rank: i + 1 })}
                  >
                    <td className="num">{i + 1}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="avatar">{initials(nameOf(r.personId))}</div>
                        {nameOf(r.personId)}
                      </div>
                    </td>
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
        {sel && <DeliveryPanel row={sel.row} rank={sel.rank} total={rows.length} onClose={() => setSel(null)} />}
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
          <div
            key={r.personId}
            className={"rank-row rank-clickable " + (i < 2 ? "top " : "") + (sel?.row.personId === r.personId ? "rank-open" : "")}
            onClick={() => setSel({ row: r, rank: i + 1 })}
          >
            <div className="rank-num">{i + 1}</div>
            <div className="avatar">{initials(nameOf(r.personId))}</div>
            <div className="rank-body">
              <div className="rank-name">{nameOf(r.personId)}</div>
              <div className="rank-sub">
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
      {sel && <DeliveryPanel row={sel.row} rank={sel.rank} total={rows.length} onClose={() => setSel(null)} />}
    </>
  );
}
