import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Assignment, Project } from "../api/types";
import { barColor, initials, stageClass, typeClass } from "../lib/format";
import { fmtElapsed, poolState, timerClass } from "../lib/time";
import { useApp } from "../state/AppContext";
import type { NotesTarget } from "../Shell";
import type { Scope } from "../components/Header";

interface DeliveryItem {
  project: Project;
  assignment: Assignment;
  /** Big structural change — only shown when the project has more than one angle; the simple (one-angle) case stays exactly as before. */
  multiAngle: boolean;
}

function RequestChange({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        Request goal change ↩
      </button>
    );
  }
  return (
    <div style={{ flex: 1 }}>
      <input
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        placeholder="e.g. lower goal to 15 — pool is thin"
        style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, marginBottom: 8, color: "var(--ink)" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          className="btn btn-dl"
          disabled={busy}
          onClick={async () => {
            if (!txt.trim()) return;
            setBusy(true);
            await onSend(txt.trim());
            setBusy(false);
            setTxt("");
            setOpen(false);
          }}
        >
          Send to PL
        </button>
      </div>
      <p style={{ fontSize: 11, color: "var(--soft)", margin: "8px 0 0", textAlign: "center" }}>
        The PL owns the goal — they'll confirm any change.
      </p>
    </div>
  );
}

export default function DeliveryTab({
  scope,
  reloadTick,
  onReload,
  onNotes,
}: {
  scope: Scope;
  reloadTick: number;
  onReload: () => void;
  onNotes: (t: NotesTarget) => void;
}) {
  const { actor, people, nameOf, nowMs, effectiveHour, effectiveAfterHours } = useApp();
  const [items, setItems] = useState<DeliveryItem[] | null>(null);
  const [openPool, setOpenPool] = useState<Project[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const load = async () => {
    const list = await api.get<Project[]>(`/projects?role=delivering&scope=${scope}&status=matched&archived=false`);
    const details = await Promise.all(
      list.map((p) => api.get<{ project: Project; assignments: Assignment[]; angles: unknown[] }>(`/projects/${p.id}`))
    );
    // §8 scope toggle — "team" means every teammate's assignments, broken out
    // per person, not just the actor's own. Filtering to `actor.id` here (as
    // this used to) silently emptied Team view for anyone whose teammates,
    // not themselves, held the assignments (bug 4).
    const relevantIds =
      scope === "team" ? new Set(people.filter((p) => p.teamId === actor.teamId).map((p) => p.id)) : new Set([actor.id]);
    const rows: DeliveryItem[] = [];
    for (const d of details) {
      for (const a of d.assignments) {
        if (relevantIds.has(a.delivererId)) rows.push({ project: d.project, assignment: a, multiAngle: d.angles.length > 1 });
      }
    }
    setItems(rows);
    setOpenPool(await api.get<Project[]>(`/projects?status=open&archived=false`));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, reloadTick]);

  const patchProgress = async (assignmentId: string, body: { delivered?: number; customDelivered?: number }) => {
    await api.patch(`/assignments/${assignmentId}/progress`, body);
    onReload();
  };

  const accept = async (projectId: string) => {
    setAcceptError(null);
    try {
      await api.post(`/projects/${projectId}/accept`, {});
      onReload();
    } catch (err) {
      setAcceptError(err instanceof ApiError ? err.message : "Could not accept this project");
    }
  };

  if (!items) return <div className="empty">Loading…</div>;

  const visibleOpenPool = openPool.filter((p) => !dismissed.has(p.id));

  // §8 Team view — grouped by person, not just a wider flat list: one
  // section per team member (including those with nothing on), each
  // showing only that member's own assignments.
  const teamMembers =
    scope === "team" ? [...people].filter((p) => p.teamId === actor.teamId).sort((a, b) => a.name.localeCompare(b.name)) : [];

  const renderCard = ({ project: p, assignment: a, multiAngle }: DeliveryItem) => {
    const doneAll = a.delivered + a.customDelivered;
    const remaining = Math.max(a.goal - doneAll, 0);
    const pct = a.goal ? Math.min(100, Math.round((doneAll / a.goal) * 100)) : 0;
    const elapsed = nowMs - new Date(a.stageEnteredAt).getTime();
    const ps = poolState(p.expertPool, effectiveHour);
    return (
      <div key={a.id} className="card">
        <div className="card-top">
          <div>
            <a className="client" href={p.projectLink} target="_blank" rel="noopener noreferrer">
              {p.client}
            </a>
            <div className="topic">
              {p.topic} · PL {nameOf(p.plId)}
              {/* Big structural change — which angle this assignment is on, only when the project has more than one. */}
              {multiAngle ? ` · ${a.angleName}` : ""}
            </div>
          </div>
          <span className={"stage-pill " + stageClass(a.stage)}>{a.stage}</span>
        </div>
        <div className="meta">
          <div className={"chip timer " + timerClass(elapsed)}>
            ⏱ {fmtElapsed(elapsed)} in {a.stage.replace(" Deliverable", "")}
          </div>
          {ps === "dormant" && <div className="chip dormant">💤 {p.expertPool} asleep — goal inactive now</div>}
          {ps === "live" && <div className="chip live">⚡ {p.expertPool} live — double weight, convert now</div>}
        </div>
        <div className="progress">
          <div className="progress-top">
            <span className="progress-num">
              {doneAll}
              <small> / {a.goal} your goal</small>
            </span>
            <span className="mono" style={{ fontSize: 12, color: remaining ? "#9A5F0C" : "#1F7D4C" }}>
              {remaining ? `${remaining} to go` : "done ✓"}
            </span>
          </div>
          <div className="bar">
            <span style={{ width: pct + "%", background: barColor(pct) }} />
          </div>
        </div>
        {
          /*
           * BUG 1 (fixed) — pool weight (the 💤/⚡ chip above) governs LOAD
           * ONLY, never eligibility to log work. A deliverer must always be
           * able to log delivered/custom-delivered on any assignment they
           * hold, at any time of day, dormant pool or not. The only gate
           * on these steppers is ownership (`a.delivererId !== actor.id`,
           * §5e) -- do not add a pool/stage/time condition here.
           */
        }
        <div className="assignees">
          <div className="assignee">
            <div className="avatar dl">✓</div>
            <div>
              <div className="assignee-name">From our system</div>
              <div className="assignee-sub">counts toward your goal</div>
            </div>
            <div className="step" style={{ marginLeft: "auto" }}>
              <button disabled={a.delivererId !== actor.id} onClick={() => patchProgress(a.id, { delivered: Math.max(0, a.delivered - 1) })}>
                −
              </button>
              <span className="val">{a.delivered}</span>
              <button disabled={a.delivererId !== actor.id} onClick={() => patchProgress(a.id, { delivered: a.delivered + 1 })}>
                +
              </button>
            </div>
          </div>
          <div className="assignee">
            <div className="avatar dl" style={{ background: "#F3E8FB", color: "#8E3BC9" }}>
              ★
            </div>
            <div>
              <div className="assignee-name">Custom sourced</div>
              <div className="assignee-sub">outside the system · also counts</div>
            </div>
            <div className="step" style={{ marginLeft: "auto" }}>
              <button
                disabled={a.delivererId !== actor.id}
                onClick={() => patchProgress(a.id, { customDelivered: Math.max(0, a.customDelivered - 1) })}
              >
                −
              </button>
              <span className="val">{a.customDelivered}</span>
              <button
                disabled={a.delivererId !== actor.id}
                onClick={() => patchProgress(a.id, { customDelivered: a.customDelivered + 1 })}
              >
                +
              </button>
            </div>
          </div>
        </div>
        {a.delivererId === actor.id && (
          <div className="actions">
            <RequestChange
              onSend={async (text) => {
                await api.post(`/assignments/${a.id}/goal-change-requests`, { body: text });
              }}
            />
          </div>
        )}
        <div className="actions">
          <button className="btn btn-ghost" onClick={() => onNotes({ projectId: p.id })}>
            📝 Notes
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {visibleOpenPool.length > 0 && (
        <>
          <div className="section-lbl" style={{ color: "#9A5F0C" }}>
            Open — up for grabs <span className="count">{visibleOpenPool.length}</span>
          </div>
          {acceptError && <div className="err-line">{acceptError}</div>}
          <div className="card-grid">
          {visibleOpenPool.map((p) => (
            <div key={p.id} className="card" style={{ borderColor: "#F0DCB0", background: "#FFFDF8" }}>
              <div className="card-top">
                <div>
                  <a className="client" href={p.projectLink} target="_blank" rel="noopener noreferrer">
                    {p.client}
                  </a>
                  <div className="topic">
                    {p.topic} · {p.expertPool}
                  </div>
                </div>
                <div className={"tag " + typeClass(p.projectType)}>{p.projectType}</div>
              </div>
              <div className="meta">
                <div className="chip">
                  N <b>{p.callsN}</b> calls
                </div>
                <div className="chip">
                  goal <b>{p.goalTotal}</b>
                </div>
              </div>
              <p style={{ fontSize: 12, color: "var(--soft)", margin: "10px 0 0" }}>
                No one was free to auto-match. {effectiveAfterHours ? "Evening volunteers — first to accept takes it." : "First to accept takes it."}
              </p>
              <div className="actions">
                <button className="btn btn-ghost" onClick={() => setDismissed((d) => new Set(d).add(p.id))}>
                  Decline
                </button>
                <button className="btn btn-dl" onClick={() => accept(p.id)}>
                  Accept
                </button>
              </div>
            </div>
          ))}
          </div>
        </>
      )}

      <div className="cov-card">
        <div className="cov-item">
          <div>
            <div className="cov-title">
              🌙 Evening coverage <span className="cov-tagline">voluntary</span>
            </div>
            <div className={"cov-state " + (actor.eveningCoverage ? "on" : "off")}>
              {actor.eveningCoverage
                ? effectiveAfterHours
                  ? "You're online now — thanks for covering! Toggle off when you're done for the night."
                  : "You're on for this evening. Thank you! You can switch off anytime."
                : effectiveAfterHours
                ? "You're set as unavailable this evening — you won't be allocated work. Toggle to change."
                : "You're off in the evenings. Toggle on to take after-hours work."}
            </div>
          </div>
        </div>
      </div>

      {scope === "team" ? (
        <>
          <div className="section-lbl">
            Team — assigned <span className="count">{items.length}</span>
          </div>
          {teamMembers.map((person) => {
            const personItems = items.filter((it) => it.assignment.delivererId === person.id);
            return (
              <div key={person.id} className="team-group">
                <div className="team-group-header">
                  <div className="avatar dl">{initials(person.name)}</div>
                  {person.name}
                  <span className="count">{personItems.length}</span>
                </div>
                {personItems.length === 0 ? (
                  <div className="empty team-group-empty">Nothing assigned right now.</div>
                ) : (
                  <div className="card-grid">{personItems.map(renderCard)}</div>
                )}
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div className="section-lbl">
            Assigned to you <span className="count">{items.length}</span>
          </div>
          {items.length === 0 && (
            <div className="empty">
              <b>Nothing assigned</b>When a PL staffs you, it lands here.
            </div>
          )}
          <div className="card-grid">{items.map(renderCard)}</div>
        </>
      )}
    </>
  );
}
