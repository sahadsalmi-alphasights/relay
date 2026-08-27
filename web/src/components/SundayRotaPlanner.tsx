import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { SundayRotaEntry } from "../api/types";
import { initials } from "../lib/format";
import { prettyDateKey, upcomingSundays } from "../lib/time";
import { useApp } from "../state/AppContext";
import { Icon } from "./Icon";

const WEEKS_STEP = 13; // ~ one quarter of Sundays

/**
 * Settings → Sunday rota — the quarter planner (design 2: people × Sundays
 * grid). Every rosterable person is a row; the next N Sundays are columns;
 * tapping a cell adds/removes them from that Sunday's rota. Column totals show
 * coverage at a glance, so a whole quarter can be planned on one screen without
 * changing views. Reuses GET/POST/DELETE /sunday-rota (manager/owner only).
 */
export default function SundayRotaPlanner({ reloadTick }: { reloadTick: number }) {
  const { people, teams, nowMs, actor } = useApp();
  const canManage = actor.isManager || actor.isOwner;

  const [weeks, setWeeks] = useState(WEEKS_STEP);
  const sundays = useMemo(() => upcomingSundays(nowMs, weeks), [nowMs, weeks]);

  // entryId keyed by `${date}|${personId}` — presence = on rota, value = the id to DELETE.
  const [byKey, setByKey] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (sundays.length === 0) return;
    const rows = await api.get<SundayRotaEntry[]>(`/sunday-rota?from=${sundays[0]}&to=${sundays[sundays.length - 1]}`);
    const m = new Map<string, string>();
    for (const e of rows) m.set(`${e.rotaDate.slice(0, 10)}|${e.personId}`, e.id);
    setByKey(m);
  };

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, reloadTick]);

  // Rosterable people (real, active, on a team), sorted by team then name.
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name.replace("Team_", "") ?? "—";
  const roster = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people
      .filter((p) => !p.deactivatedAt && !p.isGhost && p.teamId)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => teamName(a.teamId).localeCompare(teamName(b.teamId)) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, teams, search]);

  const countOn = (date: string) => {
    let n = 0;
    for (const k of byKey.keys()) if (k.startsWith(`${date}|`)) n++;
    return n;
  };

  const toggle = async (date: string, personId: string) => {
    if (!canManage) return;
    const key = `${date}|${personId}`;
    if (busy.has(key)) return;
    setBusy((s) => new Set(s).add(key));
    setError(null);
    const existingId = byKey.get(key);
    try {
      if (existingId) {
        await api.del(`/sunday-rota/${existingId}`);
        setByKey((m) => {
          const n = new Map(m);
          n.delete(key);
          return n;
        });
      } else {
        const entry = await api.post<SundayRotaEntry>("/sunday-rota", { rotaDate: date, personId });
        setByKey((m) => new Map(m).set(key, entry.id));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the rota");
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };

  return (
    <>
      <div className="scope-note">
        {canManage
          ? "Plan Sunday coverage across the whole BU — tap a cell to add or remove someone from that Sunday. Times are Asia/Dubai."
          : "Sunday coverage plan — read-only (managers set this)."}
      </div>

      <div className="srp-toolbar">
        <div className="srp-search">
          <Icon name="search" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter people…" />
        </div>
        <span className="srp-range">
          {prettyDateKey(sundays[0])} – {prettyDateKey(sundays[sundays.length - 1])} · {sundays.length} Sundays
        </span>
      </div>
      {error && <div className="err-line">{error}</div>}

      <div className="srp-scroll">
        <table className="srp-table">
          <thead>
            <tr>
              <th className="srp-name-h">Person</th>
              {sundays.map((s) => {
                const [d, mon] = prettyDateKey(s).split(" ");
                return (
                  <th key={s} className="srp-col-h">
                    <b>{d}</b>
                    <small>{mon}</small>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {roster.map((p) => (
              <tr key={p.id}>
                <td className="srp-name-c">
                  <div className="srp-person">
                    <span className="avatar">{initials(p.name)}</span>
                    <span>
                      <span className="srp-pname">{p.name}</span>
                      <span className="srp-team">{teamName(p.teamId)}</span>
                    </span>
                  </div>
                </td>
                {sundays.map((s) => {
                  const key = `${s}|${p.id}`;
                  const on = byKey.has(key);
                  return (
                    <td key={s} className="srp-cell-td">
                      <button
                        className={"srp-cell " + (on ? "on" : "") + (busy.has(key) ? " busy" : "")}
                        disabled={!canManage || busy.has(key)}
                        title={on ? `${p.name} — on ${prettyDateKey(s)}` : `Add ${p.name} to ${prettyDateKey(s)}`}
                        onClick={() => toggle(s, p.id)}
                        aria-pressed={on}
                      >
                        {on ? <Icon name="check" size={13} /> : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="srp-total">
              <td className="srp-name-c">On rota</td>
              {sundays.map((s) => (
                <td key={s} className="srp-cell-td">
                  {countOn(s)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="srp-more">
        <button className="btn btn-ghost" onClick={() => setWeeks((w) => w + WEEKS_STEP)}>
          + Show {WEEKS_STEP} more Sundays
        </button>
        {roster.length === 0 && <span className="srp-empty">No people match “{search}”.</span>}
      </div>
    </>
  );
}
