import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { SundayRotaEntry, SundaySwapRequest } from "../api/types";
import Sheet from "../components/Sheet";
import { initials } from "../lib/format";
import { prettyDateKey, upcomingSundays } from "../lib/time";
import { useApp } from "../state/AppContext";

export default function RotaSheet({ onClose }: { onClose: () => void }) {
  const { actor, people, nameOf, nowMs } = useApp();
  const teamId = actor.teamId!;
  const dates = upcomingSundays(nowMs, 6);
  const [sel, setSel] = useState(dates[0]);
  const [entries, setEntries] = useState<SundayRotaEntry[]>([]);
  const [swapReqs, setSwapReqs] = useState<SundaySwapRequest[]>([]);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const mates = people.filter((p) => p.teamId === teamId);

  const load = async () => {
    setEntries(await api.get<SundayRotaEntry[]>(`/sunday-rota?teamId=${teamId}&from=${dates[0]}&to=${dates[dates.length - 1]}`));
    setSwapReqs(await api.get<SundaySwapRequest[]>(`/sunday-swap-requests?teamId=${teamId}`));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entriesForDate = (date: string) => entries.filter((e) => e.rotaDate.slice(0, 10) === date);
  const onDate = entriesForDate(sel);
  const meEntry = onDate.find((e) => e.personId === actor.id);
  const reqsForDate = swapReqs.filter((r) => r.rotaDate.slice(0, 10) === sel);

  const toggle = async (personId: string) => {
    setBusy(true);
    try {
      const existing = onDate.find((e) => e.personId === personId);
      if (existing) {
        await api.del(`/sunday-rota/${existing.id}`);
      } else {
        await api.post("/sunday-rota", { rotaDate: sel, personId, teamId });
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const sendSwap = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.post("/sunday-swap-requests", { rotaDate: sel, note: note.trim() });
      setNote("");
      setAsking(false);
      await load();
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
    <Sheet onClose={onClose}>
      <h2>Sunday rota</h2>
        <div className="sub">
          {actor.isManager
            ? "You're a manager — tap anyone to add or remove them from a Sunday."
            : "Set by your manager. If a date doesn't work, request a swap."}
        </div>

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

        {reqsForDate.map((r) => (
          <div key={r.id} className="review-strip">
            <span>⇄</span>
            <div style={{ flex: 1 }}>
              <b>{nameOf(r.requestedBy)}</b> asks to swap: {r.note}
            </div>
            {actor.isManager && (
              <button className="btn-sm btn-pl" disabled={busy} onClick={() => resolveSwap(r.id)}>
                Resolve
              </button>
            )}
          </div>
        ))}

        <div className="section-lbl" style={{ marginTop: 14 }}>
          On rota — {prettyDateKey(sel)} <span className="count">{onDate.length}</span>
        </div>
        {mates.map((p) => {
          const on = onDate.some((e) => e.personId === p.id);
          return (
            <div
              key={p.id}
              className={"match-line " + (on ? "picked" : "")}
              onClick={actor.isManager && !busy ? () => toggle(p.id) : undefined}
              style={{ cursor: actor.isManager ? "pointer" : "default" }}
            >
              <div className="avatar">{initials(p.name)}</div>
              <div>
                <div className="assignee-name">
                  {p.name}
                  {p.id === actor.id ? " (you)" : ""}
                </div>
                <div className="assignee-sub">
                  {on ? "on this Sunday" : "off"}
                  {p.status !== "Available" ? ` · ${p.status}` : ""}
                </div>
              </div>
              {actor.isManager && (
                <span className="load-score">
                  <b>{on ? "✓" : "+"}</b>
                </span>
              )}
            </div>
          );
        })}

        {!actor.isManager && meEntry && !asking && (
          <button className="btn btn-ghost" style={{ width: "100%", marginTop: 10 }} onClick={() => setAsking(true)}>
            ⇄ Request a swap for this Sunday
          </button>
        )}
        {!actor.isManager && asking && (
          <div style={{ marginTop: 10 }}>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. can anyone take this? I'm away"
              style={{ width: "100%", padding: 11, borderRadius: 11, border: "1px solid var(--line)", fontSize: 14, background: "var(--bg)", color: "var(--ink)" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button className="btn btn-dl" disabled={busy} onClick={sendSwap}>
                Send to manager
              </button>
            </div>
          </div>
        )}

        <div className="sheet-footer">
          <button className="btn btn-pl" style={{ width: "100%" }} onClick={onClose}>
            Done
          </button>
        </div>
    </Sheet>
  );
}
