import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Person, SundayRotaEntry, SundaySwapRequest } from "../api/types";
import { initials } from "../lib/format";
import { prettyDateKey, upcomingSundays } from "../lib/time";
import { useApp } from "../state/AppContext";

/**
 * Sunday Coverage — a BU-wide schedule page (2026-07-24). Any manager/owner
 * can see and set who's on for each upcoming Sunday across EVERY team, not
 * just their own (POST/DELETE /sunday-rota are BU-wide now). Non-managers see
 * it read-only and can request a swap for a Sunday they're rostered on. This
 * replaces the older team-scoped RotaSheet as the canonical rota surface.
 */
export default function SundayCoverageTab({ reloadTick }: { reloadTick: number }) {
  const { actor, people, teams, nameOf, nowMs } = useApp();
  const canManage = actor.isManager || actor.isOwner;
  const dates = upcomingSundays(nowMs, 6);
  const [sel, setSel] = useState(dates[0]);
  const [entries, setEntries] = useState<SundayRotaEntry[]>([]);
  const [swaps, setSwaps] = useState<SundaySwapRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  const load = async () => {
    // No teamId → the whole BU (see routes/sundayRota.ts).
    setEntries(await api.get<SundayRotaEntry[]>(`/sunday-rota?from=${dates[0]}&to=${dates[dates.length - 1]}`));
    setSwaps(await api.get<SundaySwapRequest[]>(`/sunday-swap-requests`));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  const entriesForDate = (date: string) => entries.filter((e) => e.rotaDate.slice(0, 10) === date);
  const onDate = entriesForDate(sel);
  const onDateIds = new Set(onDate.map((e) => e.personId));
  const meRostered = onDateIds.has(actor.id);
  const swapsForDate = swaps.filter((r) => r.rotaDate.slice(0, 10) === sel);

  // Everyone who can be rostered: real, active people (ghosts and deactivated
  // accounts are excluded — the rota is about who actually works Sunday),
  // grouped by team.
  const rosterable = people.filter((p) => !p.deactivatedAt && !p.isGhost && p.teamId);
  const byTeam = teams
    .map((t) => ({ team: t, members: rosterable.filter((p) => p.teamId === t.id).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.members.length > 0);

  const toggle = async (person: Person) => {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    try {
      const existing = onDate.find((e) => e.personId === person.id);
      if (existing) {
        await api.del(`/sunday-rota/${existing.id}`);
      } else {
        await api.post("/sunday-rota", { rotaDate: sel, personId: person.id });
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the rota");
    } finally {
      setBusy(false);
    }
  };

  const sendSwap = async () => {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/sunday-swap-requests", { rotaDate: sel, note: note.trim() });
      setNote("");
      setAsking(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the request");
    } finally {
      setBusy(false);
    }
  };

  const resolveSwap = async (id: string) => {
    setBusy(true);
    try {
      await api.patch(`/sunday-swap-requests/${id}/resolve`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="scope-note">
        {canManage
          ? "Sunday coverage across the whole BU — tap anyone on any team to add or remove them from a Sunday."
          : "Sunday coverage across the whole BU, set by managers. If a Sunday you're on doesn't work, request a swap."}
      </div>
      {error && <div className="err-line">{error}</div>}

      <div className="rota-dates">
        {dates.map((d) => {
          const cnt = entriesForDate(d).length;
          const mine = entriesForDate(d).some((e) => e.personId === actor.id);
          return (
            <button key={d} className={"rota-date " + (sel === d ? "sel " : "") + (mine ? "mine" : "")} onClick={() => setSel(d)}>
              <b>{prettyDateKey(d)}</b>
              <small>
                {cnt} on{mine ? " · you" : ""}
              </small>
            </button>
          );
        })}
      </div>

      {swapsForDate.map((r) => (
        <div key={r.id} className="review-strip">
          <span>⇄</span>
          <div style={{ flex: 1 }}>
            <b>{nameOf(r.requestedBy)}</b> asks to swap: {r.note}
          </div>
          {canManage && (
            <button className="btn-sm btn-pl" disabled={busy} onClick={() => resolveSwap(r.id)}>
              Resolve
            </button>
          )}
        </div>
      ))}

      <div className="section-lbl" style={{ marginTop: 14 }}>
        On rota — {prettyDateKey(sel)} <span className="count">{onDate.length}</span>
        {!canManage && meRostered && !asking && (
          <button className="link-btn" style={{ marginLeft: 10 }} onClick={() => setAsking(true)}>
            ⇄ Request a swap
          </button>
        )}
      </div>

      {!canManage && asking && (
        <div style={{ display: "flex", gap: 8, margin: "0 0 12px" }}>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. can anyone take this? I'm away"
            style={{ flex: 1, padding: 11, borderRadius: 11, border: "1px solid var(--line)", fontSize: 14, background: "var(--surface)", color: "var(--ink)" }}
          />
          <button className="btn btn-ghost" onClick={() => setAsking(false)}>
            Cancel
          </button>
          <button className="btn btn-dl" disabled={busy} onClick={sendSwap}>
            Send
          </button>
        </div>
      )}

      {byTeam.map(({ team, members }) => {
        const onCount = members.filter((p) => onDateIds.has(p.id)).length;
        return (
          <div key={team.id} className="team-group">
            <div className="team-group-header">
              {team.name.replace("Team_", "")}
              <span className="count">{onCount} on</span>
            </div>
            {members.map((p) => {
              const on = onDateIds.has(p.id);
              return (
                <div
                  key={p.id}
                  className={"match-line " + (on ? "picked" : "")}
                  onClick={canManage && !busy ? () => toggle(p) : undefined}
                  style={{ cursor: canManage ? "pointer" : "default" }}
                >
                  <div className="avatar">{initials(p.name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="assignee-name">
                      {p.name}
                      {p.id === actor.id ? " (you)" : ""}
                    </div>
                    <div className="assignee-sub">
                      {on ? "on this Sunday" : "off"}
                      {p.status !== "Available" ? ` · ${p.status}` : ""}
                    </div>
                  </div>
                  {canManage && (
                    <span className="load-score" style={{ marginLeft: "auto" }}>
                      <b>{on ? "✓" : "+"}</b>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
