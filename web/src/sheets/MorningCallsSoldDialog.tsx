import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useViewport } from "../lib/useViewport";

interface DueAngle {
  id: string;
  name: string;
  callsN: number;
  callsSold: number;
}

interface DueRow {
  id: string;
  client: string;
  topic: string | null;
  angles: DueAngle[];
}

interface ParkedRow {
  id: string;
  client: string;
  topic: string | null;
}

type RowMode = "callsSold" | "idle" | "archive";

/**
 * Morning calls-sold dialog — on first load, if the PL has active projects
 * whose calls_sold hasn't been touched today, this blocks until every one is
 * actioned: enter today's number, park it (Idle), or archive it. Every row
 * defaults to "callsSold" pre-filled with the current value, so a PL with
 * nothing to change can submit immediately — always fast, never empty (if
 * there's nothing due, this renders nothing at all).
 *
 * Desktop-only: mobile shows a non-blocking reminder banner instead, so the
 * task isn't silently skipped, but isn't forced through a cramped table
 * either. Same breakpoint the rest of the app already uses (useViewport).
 *
 * Fetched once per Shell mount ("first load") — no separate day-tracking
 * flag needed: submitting clears every due row server-side, so the very
 * next fetch (next page load) naturally comes back empty until tomorrow's
 * calendar day makes today's touch stale again.
 */
export default function MorningCallsSoldDialog({ onActioned }: { onActioned: () => void }) {
  const { isDesktop } = useViewport();
  const [due, setDue] = useState<DueRow[] | null>(null);
  const [parked, setParked] = useState<ParkedRow[]>([]);
  const [modes, setModes] = useState<Record<string, RowMode>>({});
  const [values, setValues] = useState<Record<string, number>>({});
  const [parkedOpen, setParkedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ due: DueRow[]; parked: ParkedRow[] }>("/projects/calls-sold-due").then((res) => {
      setDue(res.due);
      setParked(res.parked);
      const initialModes: Record<string, RowMode> = {};
      const initialValues: Record<string, number> = {};
      for (const row of res.due) {
        initialModes[row.id] = "callsSold";
        for (const ang of row.angles) initialValues[ang.id] = ang.callsSold;
      }
      setModes(initialModes);
      setValues(initialValues);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!due || due.length === 0) return null;

  if (!isDesktop) {
    return (
      <div className="morning-banner">
        📞 <b>{due.length}</b> project{due.length > 1 ? "s" : ""} need{due.length > 1 ? "" : "s"} today's calls-sold
        update — open Relay on a desktop to update.
      </div>
    );
  }

  const setMode = (projectId: string, mode: RowMode) => setModes((m) => ({ ...m, [projectId]: mode }));
  const setAngleValue = (angleId: string, v: number) => setValues((vs) => ({ ...vs, [angleId]: Math.max(0, v) }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const row of due) {
        const mode = modes[row.id] ?? "callsSold";
        if (mode === "idle") {
          await api.post(`/projects/${row.id}/idle`);
        } else if (mode === "archive") {
          await api.post(`/projects/${row.id}/archive`);
        } else {
          for (const ang of row.angles) {
            await api.patch(`/angles/${ang.id}`, { callsSold: values[ang.id] ?? ang.callsSold });
          }
        }
      }
      setDue([]);
      onActioned();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save — try again");
      setBusy(false);
    }
  };

  return (
    <div className="scrim scrim-dialog">
      <div className="sheet sheet-dialog morning-dialog">
        <h2>Update calls sold</h2>
        <div className="sub">
          {due.length} project{due.length > 1 ? "s" : ""} need today's number — enter it, park it, or archive it.
        </div>
        {error && <div className="err-line">{error}</div>}
        <table className="data-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Project</th>
              <th className="num">N</th>
              <th>Calls sold</th>
            </tr>
          </thead>
          <tbody>
            {due.map((row) => {
              const mode = modes[row.id] ?? "callsSold";
              return (
                <tr key={row.id}>
                  <td>{row.client}</td>
                  <td>{row.topic}</td>
                  <td className="num">{row.angles.reduce((s, a) => s + a.callsN, 0)}</td>
                  <td>
                    {mode === "callsSold" &&
                      row.angles.map((ang) => (
                        <div key={ang.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          {row.angles.length > 1 && (
                            <span style={{ fontSize: 11, color: "var(--soft)", minWidth: 90 }}>{ang.name}</span>
                          )}
                          <input
                            type="number"
                            min={0}
                            value={values[ang.id] ?? ang.callsSold}
                            onChange={(e) => setAngleValue(ang.id, Number(e.target.value))}
                            style={{ width: 70, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, color: "var(--ink)" }}
                          />
                        </div>
                      ))}
                    {mode === "idle" && <span className="idle-badge">Will be parked</span>}
                    {mode === "archive" && <span className="idle-badge">Will be archived</span>}
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        className={"btn-sm " + (mode === "idle" ? "btn-pl" : "btn-ghost")}
                        onClick={() => setMode(row.id, mode === "idle" ? "callsSold" : "idle")}
                      >
                        {mode === "idle" ? "✓ Parking" : "Idle"}
                      </button>
                      <button
                        className={"btn-sm " + (mode === "archive" ? "btn-pl" : "btn-ghost")}
                        onClick={() => setMode(row.id, mode === "archive" ? "callsSold" : "archive")}
                      >
                        {mode === "archive" ? "✓ Archiving" : "Archive"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {parked.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button className="link-btn" onClick={() => setParkedOpen((o) => !o)} style={{ marginLeft: 0 }}>
              {parkedOpen ? "▾" : "▸"} Parked <span className="count">{parked.length}</span>
            </button>
            {parkedOpen && (
              <div style={{ marginTop: 8 }}>
                {parked.map((p) => (
                  <div key={p.id} className="rank-row">
                    <div className="rank-body">
                      <div className="rank-name">{p.client}</div>
                      <div className="rank-sub">{p.topic}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="sheet-footer">
          <button className="btn btn-pl" style={{ width: "100%" }} disabled={busy} onClick={submit}>
            {busy ? "Saving…" : `Submit — ${due.length} project${due.length > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
