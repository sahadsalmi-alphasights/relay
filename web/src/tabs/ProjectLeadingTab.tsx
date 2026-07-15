import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Assignment, GoalChangeRequest, Project } from "../api/types";
import { barColor, initials, paceInfo, stageClass, typeClass } from "../lib/format";
import { fmtElapsed, poolState, timerClass } from "../lib/time";
import { useApp } from "../state/AppContext";
import type { NotesTarget } from "../Shell";
import type { Scope } from "../components/Header";

interface ProjectItem {
  project: Project;
  assignments: Assignment[];
  pending: GoalChangeRequest[];
}

function projStats(assignments: Assignment[]) {
  const goal = assignments.reduce((s, a) => s + a.goal, 0);
  const done = assignments.reduce((s, a) => s + a.delivered + a.customDelivered, 0);
  const pct = goal ? Math.min(100, Math.round((done / goal) * 100)) : 0;
  return { goal, done, pct };
}

/**
 * BUG 3 (fixed) — this used to be the project-level "Edit goals" button
 * (a multi-assignee dropdown). Goal editing is now per-assignee, a small
 * inline stepper right on that assignee's own row — "Edit team" (below)
 * is what changes/adds deliverers now.
 */
function AssigneeGoalEditor({ assignment, onSave }: { assignment: Assignment; onSave: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const patch = async (goal: number) => {
    setBusy(true);
    try {
      await api.patch(`/assignments/${assignment.id}/goal`, { goal });
      onSave();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="assignee-num">
        {assignment.delivered + assignment.customDelivered}/{assignment.goal}
        <button
          className="btn-sm"
          style={{ display: "block", marginTop: 4, color: "var(--pl)", background: "var(--pl-soft)" }}
          onClick={() => setOpen(true)}
        >
          Edit goals
        </button>
      </div>
    );
  }

  return (
    <div className="assignee-num" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <div className="step">
        <button disabled={busy} onClick={() => patch(Math.max(0, assignment.goal - 1))}>
          −
        </button>
        <span className="val">{assignment.goal}</span>
        <button disabled={busy} onClick={() => patch(assignment.goal + 1)}>
          +
        </button>
      </div>
      <button className="btn-sm btn-ghost" onClick={() => setOpen(false)}>
        ✓ Done
      </button>
    </div>
  );
}

/**
 * §5 (eight changes) — changing an assignee's stage prompts for a new goal
 * for the new stage, which starts a new round (§3/§9 — previous round
 * archived, new round starts at 0 delivered): the goal PATCH is what
 * triggers that, so this does both in sequence.
 */
function AdvanceWithGoal({ assignment, onSave }: { assignment: Assignment; onSave: () => void }) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState(assignment.goal);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        className="btn-sm btn-ghost"
        disabled={assignment.stage === "Selling"}
        onClick={() => {
          setGoal(assignment.goal);
          setOpen(true);
        }}
      >
        Advance →
      </button>
    );
  }

  const confirm = async () => {
    setBusy(true);
    try {
      await api.post(`/assignments/${assignment.id}/stage/advance`);
      await api.patch(`/assignments/${assignment.id}/goal`, { goal });
      onSave();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>New goal for next stage</span>
      <div className="step">
        <button disabled={busy} onClick={() => setGoal((g) => Math.max(0, g - 1))}>
          −
        </button>
        <span className="val">{goal}</span>
        <button disabled={busy} onClick={() => setGoal((g) => g + 1)}>
          +
        </button>
      </div>
      <button className="btn-sm btn-pl" disabled={busy} onClick={confirm}>
        Confirm
      </button>
      <button className="btn-sm btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

// §8.1 — calls_sold is manual for now: the PL types it in here, same
// collapsed/expanded pattern as GoalEditor. PL-only; PATCH /projects/:id
// enforces that server-side (canEditProjectFields), independent of this UI.
function CallsSoldEditor({ project, onSave }: { project: Project; onSave: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="btn btn-pl" onClick={() => setOpen(true)}>
        Edit calls sold
      </button>
    );
  }

  const patch = async (callsSold: number) => {
    setBusy(true);
    try {
      await api.patch(`/projects/${project.id}`, { callsSold });
      onSave();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, color: "var(--ink)" }}>
          Calls sold <span style={{ color: "var(--soft)", fontWeight: 500 }}>· of {project.callsN}</span>
        </span>
        <div className="step">
          <button disabled={busy} onClick={() => patch(Math.max(0, project.callsSold - 1))}>
            −
          </button>
          <span className="val">{project.callsSold}</span>
          <button disabled={busy} onClick={() => patch(project.callsSold + 1)}>
            +
          </button>
        </div>
      </div>
      <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => setOpen(false)}>
        Done
      </button>
    </div>
  );
}

export default function ProjectLeadingTab({
  scope,
  reloadTick,
  onReload,
  onPendingCount,
  onEditTeam,
  onNotes,
}: {
  scope: Scope;
  reloadTick: number;
  onReload: () => void;
  onPendingCount: (n: number) => void;
  onEditTeam: (projectId: string) => void;
  onNotes: (t: NotesTarget) => void;
}) {
  const { actor, people, nameOf, practiceOf, nowMs, effectiveHour } = useApp();
  const [items, setItems] = useState<ProjectItem[] | null>(null);
  const [archived, setArchived] = useState<Project[]>([]);

  const load = async () => {
    const active = await api.get<Project[]>(`/projects?role=leading&scope=${scope}&archived=false`);
    const archivedList = await api.get<Project[]>(`/projects?role=leading&scope=${scope}&archived=true`);
    const details = await Promise.all(
      active.map((p) => api.get<{ project: Project; assignments: Assignment[] }>(`/projects/${p.id}`))
    );
    // §5e — only a project's own PL may view its pending goal-change requests
    // (GET .../goal-change-requests 403s for anyone else). Under Team view,
    // `active` includes teammates' projects the actor doesn't lead; fetching
    // this indiscriminately for every project rejected inside Promise.all,
    // which silently aborted the whole load() and froze the tab on stale
    // (often empty) state — the actual cause of "Team view shows nothing."
    const pending = await Promise.all(
      active.map((p) =>
        p.plId === actor.id
          ? api.get<GoalChangeRequest[]>(`/projects/${p.id}/goal-change-requests`)
          : Promise.resolve<GoalChangeRequest[]>([])
      )
    );
    setItems(active.map((p, i) => ({ project: details[i].project, assignments: details[i].assignments, pending: pending[i] })));
    setArchived(archivedList);
    onPendingCount(pending.reduce((sum, arr) => sum + arr.length, 0));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, reloadTick]);

  const resolveRequest = async (id: string) => {
    await api.patch(`/goal-change-requests/${id}/resolve`);
    onReload();
  };
  // §6/§8 — stage is per-assignment now (domain change 8). Advance now goes
  // through AdvanceWithGoal (§5 -- prompts for a new goal, starting a new
  // round); "back" (mis-click recovery) stays a direct action.
  const backAssignmentStage = async (assignmentId: string) => {
    await api.post(`/assignments/${assignmentId}/stage/back`);
    onReload();
  };
  const archiveProject = async (id: string) => {
    await api.post(`/projects/${id}/archive`);
    onReload();
  };
  const resurface = async (id: string) => {
    await api.post(`/projects/${id}/resurface`);
    onReload();
  };

  if (!items) return <div className="empty">Loading…</div>;

  // §8 Team view — grouped by person, not just a wider flat list: one
  // section per team member (including those leading nothing), each
  // showing only the projects that member leads.
  const teamMembers =
    scope === "team" ? [...people].filter((p) => p.teamId === actor.teamId).sort((a, b) => a.name.localeCompare(b.name)) : [];

  // §8.1 — end-of-day nudge: the actor's OWN active led projects whose
  // calls_sold hasn't been touched today, regardless of scope (Team view
  // can list teammates' projects the actor can't edit, so this always
  // narrows to the actor's own, same set "mine" scope would show).
  const myStaleProjects = items.filter((it) => it.project.plId === actor.id && it.project.needsCallsSoldUpdate);

  const renderCard = ({ project: p, assignments }: ProjectItem) => {
        const { goal, done, pct } = projStats(assignments);
        const pace = paceInfo(pct, p.earliestStage ?? "First Deliverable");
        const ps = poolState(p.expertPool, effectiveHour);
        const totalDelivered = assignments.reduce((s, a) => s + a.delivered + a.customDelivered, 0);
        const chase = totalDelivered > 0 && p.callsSold < p.callsN;

        return (
          <div key={p.id} className="card">
            <div className="card-top">
              <div>
                <a className="client" href={p.projectLink} target="_blank" rel="noopener noreferrer">
                  {p.client}
                </a>
                <div className="topic">
                  {p.topic} {p.account ? `· ${p.account}` : ""}
                </div>
              </div>
              <div className={"tag " + typeClass(p.projectType)}>{p.projectType}</div>
            </div>
            <div className="meta single-line">
              <div className="chip">
                N <b>{p.callsN}</b> calls
              </div>
              <div className={"chip pool " + (ps === "dormant" ? "dormant" : ps === "live" ? "live" : "")}>
                {p.expertPool}
                {ps === "live" ? " · live 2×" : ps === "dormant" ? " · asleep" : ""}
              </div>
              <div className="chip">
                sold <b>{p.callsSold}</b>
              </div>
            </div>
            <div className="progress">
              <div className="progress-top">
                <span className="progress-num">
                  {done}
                  <small> / {goal} profiles</small>
                </span>
                <span className="mono" style={{ fontSize: 12, color: "var(--soft)" }}>
                  goal {p.goalTotal}
                </span>
              </div>
              <div className="bar">
                <span style={{ width: pct + "%", background: barColor(pct) }} />
              </div>
            </div>
            <div className="stage-row">
              {/* BUG 2 (fixed) — stage is per-deliverer now (§3/§8); the
                  rolled-up "Earliest: X" project-level label doesn't need
                  surfacing here — each assignee below shows their own. Only
                  the unstaffed case is still worth a pill (that's staffing
                  status, not a stage). */}
              {!p.earliestStage && <span className="stage-pill stage-selling">Not yet staffed</span>}
              {chase && (
                <span className="chip" style={{ color: "#A82F2F", background: "var(--red-bg)" }}>
                  delivered, not sold — chase client
                </span>
              )}
              {p.earliestStage && (
                <span className="pace" style={{ color: pace.color }}>
                  <span className="dot" style={{ background: pace.color }} />
                  {pace.label}
                </span>
              )}
            </div>
            <div className="assignees">
              {assignments.map((a) => {
                const elapsed = nowMs - new Date(a.stageEnteredAt).getTime();
                return (
                  <div key={a.id}>
                    <div className="assignee">
                      <div className="avatar">{initials(nameOf(a.delivererId))}</div>
                      <div>
                        <div className="assignee-name">
                          {nameOf(a.delivererId)} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {practiceOf(a.delivererId)}</span>
                        </div>
                        <div className="assignee-sub">{a.customDelivered > 0 ? `incl. ${a.customDelivered} custom` : "no custom"}</div>
                      </div>
                      <AssigneeGoalEditor assignment={a} onSave={onReload} />
                    </div>
                    {/* §6/§8 — this assignee's own stage, timer, and advance/back (per-deliverer, domain change 8). */}
                    <div className="assignee-actions-row">
                      {/* (bug fix, three-across) the adjacent stage-pill already
                          names the stage, so the timer chip doesn't repeat it --
                          frees up enough width for this row to stay on one line. */}
                      <span className={"stage-pill " + stageClass(a.stage)}>{a.stage}</span>
                      <span className={"chip timer " + timerClass(elapsed)}>⏱ {fmtElapsed(elapsed)}</span>
                      <button
                        className="btn-sm btn-ghost"
                        disabled={a.stage === "First Deliverable"}
                        onClick={() => backAssignmentStage(a.id)}
                      >
                        ← Back
                      </button>
                      <AdvanceWithGoal assignment={a} onSave={onReload} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="actions">
              <button className="btn btn-pl" onClick={() => onEditTeam(p.id)}>
                Edit team
              </button>
            </div>
            <div className="actions">
              <CallsSoldEditor project={p} onSave={onReload} />
            </div>
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => onNotes({ projectId: p.id })}>
                📝 Notes
              </button>
              <button className="btn btn-ghost" onClick={() => archiveProject(p.id)}>
                Archive
              </button>
            </div>
          </div>
        );
  };

  return (
    <>
      {myStaleProjects.length > 0 && (
        <div className="review-strip" style={{ borderColor: "#F0DCB0", background: "#FFFDF8" }}>
          <span>📞</span>
          <div style={{ flex: 1 }}>
            <b>Update calls sold</b> for today: {myStaleProjects.map((it) => it.project.client).join(", ")}
          </div>
        </div>
      )}

      {items
        .filter((it) => it.pending.length > 0)
        .flatMap((it) =>
          it.pending.map((r) => (
            <div key={r.id} className="review-strip">
              <span>↩</span>
              <div style={{ flex: 1 }}>
                <b>{nameOf(r.requestedBy)}</b> requests: {r.body}
              </div>
              <button className="btn-sm btn-pl" onClick={() => resolveRequest(r.id)}>
                Resolve
              </button>
            </div>
          ))
        )}

      {scope === "team" ? (
        <>
          <div className="section-lbl">
            Team — projects led <span className="count">{items.length}</span>
          </div>
          {teamMembers.map((person) => {
            const personItems = items.filter((it) => it.project.plId === person.id);
            return (
              <div key={person.id} className="team-group">
                <div className="team-group-header">
                  <div className="avatar">{initials(person.name)}</div>
                  {person.name}
                  <span className="count">{personItems.length}</span>
                </div>
                {personItems.length === 0 ? (
                  <div className="empty team-group-empty">Leading nothing right now.</div>
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
            Projects you lead <span className="count">{items.length}</span>
          </div>
          {items.length === 0 && (
            <div className="empty">
              <b>No projects yet</b>Tap "New project" to add one and auto-staff it.
            </div>
          )}
          <div className="card-grid">{items.map(renderCard)}</div>
        </>
      )}

      {archived.length > 0 && (
        <>
          <div className="section-lbl spaced">
            Archived <span className="count">{archived.length}</span>
          </div>
          {archived.map((p) => (
            <div key={p.id} className="rank-row">
              <div className="rank-body">
                <div className="rank-name">
                  {p.client} · {p.topic}
                </div>
                <div className="rank-sub">
                  <span>
                    {p.projectType} · {p.expertPool}
                  </span>
                </div>
              </div>
              <button className="btn-sm btn-pl" onClick={() => resurface(p.id)}>
                Resurface
              </button>
            </div>
          ))}
        </>
      )}
    </>
  );
}
