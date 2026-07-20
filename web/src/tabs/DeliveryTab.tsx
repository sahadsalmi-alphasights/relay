import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Assignment, CapacityRankRow, Project, ProjectStatus } from "../api/types";
import { barColor, entityBrand, entityTint, initials, overDelivered, stageClass, stageLabel, typeClass } from "../lib/format";
import EntityLogo from "../components/EntityLogo";
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

/**
 * CHANGE 3 — one row per angle still needing seats, not one card per
 * project: a multi-angle project can have some angles fully staffed and
 * others still broadcasting. `remaining` is recomputed server-side on every
 * fetch (rules/suggestedGoal.ts's suggestStaffing(), the same formula
 * intake itself suggests — see repositories/angles.ts seatTargetForAngle()
 * for why there's no stored target).
 */
interface BroadcastRow {
  projectId: string;
  client: string;
  topic: string | null;
  projectLink: string;
  projectType: Project["projectType"];
  expertPool: Project["expertPool"];
  angleId: string;
  angleName: string;
  callsN: number;
  goalTotal: number;
  remaining: number;
}

/**
 * Batch S, item 4 — the requested goal is now a real number, not something
 * buried in free text ("lower goal to 15 — pool is thin"), and the flow also
 * asks for a target project status. `body` stays as optional rationale, no
 * longer the only signal the PL has to work from.
 */
function RequestChange({
  currentGoal,
  currentStatus,
  onSend,
}: {
  currentGoal: number;
  currentStatus: ProjectStatus;
  onSend: (body: string, requestedGoal: number, requestedStatus: ProjectStatus) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState("");
  const [goal, setGoal] = useState(currentGoal);
  const [status, setStatus] = useState<ProjectStatus>(currentStatus);
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
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <label style={{ flex: 1, fontSize: 12, color: "var(--soft)" }}>
          Requested goal
          <input
            type="number"
            min={0}
            value={goal}
            onChange={(e) => setGoal(Math.max(0, Number(e.target.value)))}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, color: "var(--ink)" }}
          />
        </label>
        <label style={{ flex: 1, fontSize: 12, color: "var(--soft)" }}>
          Requested status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, color: "var(--ink)" }}
          >
            <option value="open">Open</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>
      <input
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        placeholder="Optional — e.g. pool is thin"
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
            setBusy(true);
            await onSend(txt.trim(), goal, status);
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
  focusProject,
}: {
  scope: Scope;
  reloadTick: number;
  onReload: () => void;
  onNotes: (t: NotesTarget) => void;
  focusProject?: { id: string; tick: number } | null;
}) {
  const { actor, people, nameOf, nowMs, demoHour, effectiveHour, effectiveAfterHours } = useApp();
  const [items, setItems] = useState<DeliveryItem[] | null>(null);
  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [acceptError, setAcceptError] = useState<string | null>(null);
  // Manager feedback batch, item 7 — the actor's own row from the existing,
  // already-tested GET /capacity-ranking (personLoad + rawRemaining<=median
  // "free", rules/load.ts) -- same computation ProjectLeadingTab's team
  // panel and CapacityRankingTab itself already read, not a new definition.
  const [myCapacity, setMyCapacity] = useState<CapacityRankRow | null>(null);

  // Notification deep-link: scroll + pulse the target card (see Shell).
  useEffect(() => {
    if (!focusProject || !items) return;
    const el = document.querySelector(`[data-project-id="${focusProject.id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("card-flash");
    const t = setTimeout(() => el.classList.remove("card-flash"), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusProject?.tick, items]);

  const load = async () => {
    const list = await api.get<Project[]>(`/projects?role=delivering&scope=${scope}&status=active`);
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
    // CHANGE 3 — broadcast fallback: one row per angle still needing seats
    // (org-wide, same visibility the old whole-project open pool always
    // had), not one card per project.
    setBroadcasts(await api.get<BroadcastRow[]>(`/projects/broadcasts`));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, reloadTick]);

  useEffect(() => {
    api.get<CapacityRankRow[]>("/capacity-ranking").then((rows) => setMyCapacity(rows.find((r) => r.personId === actor.id) ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick, demoHour]);

  const patchProgress = async (assignmentId: string, body: { delivered?: number; customDelivered?: number }) => {
    await api.patch(`/assignments/${assignmentId}/progress`, body);
    onReload();
  };

  // CHANGE 3 — claims ONE seat on this specific angle; unlike the old
  // whole-project accept, the same angle (or a sibling angle on the same
  // project) can still show up here afterward if it isn't fully staffed yet.
  const claim = async (angleId: string) => {
    setAcceptError(null);
    try {
      await api.post(`/angles/${angleId}/claim`, {});
      onReload();
    } catch (err) {
      setAcceptError(err instanceof ApiError ? err.message : "Could not claim this seat");
    }
  };

  if (!items) return <div className="empty">Loading…</div>;

  // Decline hides it for THIS person only, this session — same client-side-only
  // pattern the open pool already used before broadcasts existed (never
  // persisted: a real per-person "declined" record would need a new table,
  // out of scope for this batch's no-schema-changes constraint).
  const visibleBroadcasts = broadcasts.filter((b) => !dismissed.has(b.angleId));

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
    // Manager feedback batch, item 8 — visual only: derived from the same
    // delivered/customDelivered vs goal every progress bar already reads,
    // nothing new tracked. `pct` above stays capped at 100 for the bar's
    // width; only the fill colour changes when over.
    const over = overDelivered(doneAll, a.goal);
    return (
      <div key={a.id} className="card" data-project-id={p.id} style={{ borderTop: `3px solid ${entityBrand(p.clientEntity)}` }}>
        {/* Manager feedback batch, item 2 — same header tint as the project
            board (§format.ts CLIENT_ENTITY_MAP, one shared config, not
            duplicated) -- managers reported the delivery board had no
            colour at all. */}
        <div className="card-top" style={{ background: entityTint(p.clientEntity) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <EntityLogo entity={p.clientEntity} />
            <div style={{ minWidth: 0 }}>
            <a className="client" href={p.projectLink} target="_blank" rel="noopener noreferrer">
              {p.client}
            </a>
            <div className="topic">
              {p.topic} · PL {nameOf(p.plId)}
              {/* Big structural change — which angle this assignment is on, only when the project has more than one. */}
              {multiAngle ? ` · ${a.angleName}` : ""}
              {/* "Invisible competition" — visible to everyone, no access gating. */}
              {a.isGhost && <span className="picktag" style={{ marginLeft: 6 }}>👻 Ghost</span>}
            </div>
            </div>
          </div>
          <span className={"stage-pill " + stageClass(a.stage)}>{stageLabel(a.stage)}</span>
        </div>
        <div className="meta">
          <div className={"chip timer " + timerClass(elapsed)}>
            ⏱ {fmtElapsed(elapsed)} in {stageLabel(a.stage).replace(" Deliverable", "")}
          </div>
          {ps === "dormant" && <div className="chip dormant">💤 {p.expertPool} asleep — goal inactive now</div>}
          {ps === "live" && <div className="chip live">⚡ {p.expertPool} live — double weight, convert now</div>}
          {over > 0 && <div className="chip overdelivered">Overdelivered +{over}</div>}
        </div>
        <div className="progress">
          <div className="progress-top">
            <span className="progress-num">
              {doneAll}
              <small> / {a.goal} your goal</small>
            </span>
            <span className="mono" style={{ fontSize: 12, color: remaining ? "#9A5F0C" : "#1F7D4C" }}>
              {remaining ? `${remaining} to go` : "Done ✓"}
            </span>
          </div>
          <div className="bar">
            <span style={{ width: pct + "%", background: over > 0 ? "var(--overdelivered)" : barColor(pct) }} />
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
              <div className="assignee-sub">Counts toward your goal</div>
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
              <div className="assignee-sub">Outside the system · also counts</div>
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
              currentGoal={a.goal}
              currentStatus={p.status}
              onSend={async (body, requestedGoal, requestedStatus) => {
                await api.post(`/assignments/${a.id}/goal-change-requests`, { body, requestedGoal, requestedStatus });
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
      {visibleBroadcasts.length > 0 && (
        <>
          <div className="section-lbl" style={{ color: "#9A5F0C" }}>
            Open — up for grabs <span className="count">{visibleBroadcasts.length}</span>
          </div>
          {acceptError && <div className="err-line">{acceptError}</div>}
          <div className="card-grid">
          {visibleBroadcasts.map((b) => (
            <div key={b.angleId} className="card" style={{ borderColor: "#F0DCB0", background: "#FFFDF8" }}>
              <div className="card-top">
                <div>
                  <a className="client" href={b.projectLink} target="_blank" rel="noopener noreferrer">
                    {b.client}
                  </a>
                  <div className="topic">
                    {b.topic}
                    {/* CHANGE 1/3 — angle name shown whenever a project has more than one broadcasting angle, same convention as the assigned-board cards. */}
                    {broadcasts.filter((o) => o.projectId === b.projectId).length > 1 ? ` · ${b.angleName}` : ""} · {b.expertPool}
                  </div>
                </div>
                <div className={"tag " + typeClass(b.projectType)}>{b.projectType}</div>
              </div>
              <div className="meta">
                <div className="chip">
                  N <b>{b.callsN}</b> calls
                </div>
                <div className="chip">
                  goal <b>{b.goalTotal}</b>
                </div>
                <div className="chip">
                  <b>{b.remaining}</b> seat{b.remaining > 1 ? "s" : ""} open
                </div>
              </div>
              <p style={{ fontSize: 12, color: "var(--soft)", margin: "10px 0 0" }}>
                Everyone's busy on fresh projects. {effectiveAfterHours ? "Evening volunteers — first to accept takes a seat." : "First to accept takes a seat."}
              </p>
              <div className="actions">
                <button className="btn btn-ghost" onClick={() => setDismissed((d) => new Set(d).add(b.angleId))}>
                  Decline
                </button>
                <button className="btn btn-dl" onClick={() => claim(b.angleId)}>
                  Accept
                </button>
              </div>
            </div>
          ))}
          </div>
        </>
      )}

      {/* Manager feedback batch, item 7 — the deliverer's own capacity/cap,
          not previously surfaced here at all. Same card pattern as the
          evening-coverage card below it. */}
      {myCapacity && (
        <div className="cov-card">
          <div className="cov-item">
            <div>
              <div className="cov-title">📊 Your capacity</div>
              <div className="cov-state">
                Load <b className="mono">{myCapacity.load.toFixed(1)}</b>
                {!myCapacity.eligible ? (
                  <span className="mini off" style={{ marginLeft: 8 }}>
                    Off
                  </span>
                ) : myCapacity.free ? (
                  <span className="mini free" style={{ marginLeft: 8 }}>
                    Free
                  </span>
                ) : (
                  <span className="mini busy" style={{ marginLeft: 8 }}>
                    Busy
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
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
