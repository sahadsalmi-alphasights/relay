import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Angle, Assignment, CapacityRankRow, GoalChangeRequest, Project, Stage } from "../api/types";
import { barColor, entityTint, initials, overDelivered, paceInfo, stageClass, stageLabel, typeClass } from "../lib/format";
import { fmtElapsed, poolState, timerClass } from "../lib/time";
import { useApp } from "../state/AppContext";
import type { NotesTarget } from "../Shell";
import type { Scope } from "../components/Header";

// Phase D, item 1 — dropdown options in stage order; only the "Selling" ->
// "Admin" label differs from the stored value (display-only, §format.ts).
const STAGE_OPTIONS: { value: Stage; label: string }[] = [
  { value: "First Deliverable", label: "First Deliverable" },
  { value: "Second Deliverable", label: "Second Deliverable" },
  { value: "Hail Mary", label: "Hail Mary" },
  { value: "Selling", label: stageLabel("Selling") },
];

// Phase D, item 3 — sold pulse bar color bands: <25% red, 25-<50% amber, >=50% green.
function soldBarColor(attainment: number): string {
  if (attainment < 0.25) return "var(--red)";
  if (attainment < 0.5) return "var(--amber)";
  return "var(--green)";
}

interface ProjectItem {
  project: Project;
  assignments: Assignment[];
  angles: Angle[];
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

  // Manager feedback batch, item 8 — visual only, derived from the same
  // delivered/customDelivered vs goal fields the stepper already reads.
  const over = overDelivered(assignment.delivered + assignment.customDelivered, assignment.goal);

  if (!open) {
    return (
      <div className="assignee-num">
        <span style={over > 0 ? { color: "var(--overdelivered)" } : undefined}>
          {assignment.delivered + assignment.customDelivered}/{assignment.goal}
        </span>
        {over > 0 && (
          <div className="chip overdelivered" style={{ display: "inline-block", marginTop: 2 }}>
            +{over}
          </div>
        )}
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
 * Phase D, item 1 — each deliverer row gets a dropdown that sets that
 * deliverer's stage directly, and can jump straight to a later phase,
 * skipping intermediates (unlike the old one-step advance/back). Picking a
 * phase always prompts for a new goal — never an auto-goal from the phase —
 * and reuses the exact existing round/archive mechanism (§3/§9): the stage
 * PATCH, then the goal PATCH in sequence, same two-call pattern the old
 * "Advance" button already used, just against a caller-picked target stage
 * instead of a computed "next."
 */
function StageDropdown({ assignment, onSave }: { assignment: Assignment; onSave: () => void }) {
  const [pendingStage, setPendingStage] = useState<Stage | null>(null);
  const [goal, setGoal] = useState(assignment.goal);
  const [busy, setBusy] = useState(false);

  if (pendingStage) {
    const confirm = async () => {
      setBusy(true);
      try {
        await api.patch(`/assignments/${assignment.id}/stage`, { stage: pendingStage });
        await api.patch(`/assignments/${assignment.id}/goal`, { goal });
        onSave();
      } finally {
        setBusy(false);
        setPendingStage(null);
      }
    };
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>
          New goal for {stageLabel(pendingStage)}
        </span>
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
        <button className="btn-sm btn-ghost" disabled={busy} onClick={() => setPendingStage(null)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <select
      className="stage-select"
      value={assignment.stage}
      onChange={(e) => {
        setGoal(assignment.goal);
        setPendingStage(e.target.value as Stage);
      }}
    >
      {STAGE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * §8.1 — calls_sold is manual for now: the PL types it in here, same
 * collapsed/expanded pattern as before. Big structural change — calls_sold
 * lives on each angle now, not the project: one stepper per angle, PL-only;
 * PATCH /angles/:id enforces that server-side, independent of this UI. The
 * one-angle case renders identically to the old single-stepper UI (just
 * without an angle-name prefix).
 */
function CallsSoldEditor({ angles, onSave }: { angles: Angle[]; onSave: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="btn btn-pl" onClick={() => setOpen(true)}>
        Edit calls sold
      </button>
    );
  }

  const patch = async (angleId: string, callsSold: number) => {
    setBusy(true);
    try {
      await api.patch(`/angles/${angleId}`, { callsSold });
      onSave();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ flex: 1 }}>
      {angles.map((ang) => (
        <div key={ang.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, flex: 1, color: "var(--ink)" }}>
            {angles.length > 1 ? `${ang.name} — ` : ""}
            Calls sold <span style={{ color: "var(--soft)", fontWeight: 500 }}>· of {ang.callsN}</span>
          </span>
          <div className="step">
            <button disabled={busy} onClick={() => patch(ang.id, Math.max(0, ang.callsSold - 1))}>
              −
            </button>
            <span className="val">{ang.callsSold}</span>
            <button disabled={busy} onClick={() => patch(ang.id, ang.callsSold + 1)}>
              +
            </button>
          </div>
        </div>
      ))}
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
  onEditProject,
  onNotes,
}: {
  scope: Scope;
  reloadTick: number;
  onReload: () => void;
  onPendingCount: (n: number) => void;
  onEditTeam: (projectId: string) => void;
  onEditProject: (projectId: string) => void;
  onNotes: (t: NotesTarget) => void;
}) {
  const { actor, people, nameOf, practiceOf, nowMs, effectiveHour, demoHour } = useApp();
  const [items, setItems] = useState<ProjectItem[] | null>(null);
  const [archived, setArchived] = useState<Project[]>([]);
  // Phase D, item 5 — team-overview running list. Reuses the existing,
  // already-tested GET /capacity-ranking computation (personLoad + the
  // rawRemaining<=median "free" rule, rules/load.ts) rather than inventing a
  // second definition of load or free for this one screen.
  const [rankRows, setRankRows] = useState<CapacityRankRow[] | null>(null);

  const load = async () => {
    const active = await api.get<Project[]>(`/projects?role=leading&scope=${scope}&archived=false`);
    const archivedList = await api.get<Project[]>(`/projects?role=leading&scope=${scope}&archived=true`);
    const details = await Promise.all(
      active.map((p) => api.get<{ project: Project; assignments: Assignment[]; angles: Angle[] }>(`/projects/${p.id}`))
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
    setItems(
      active.map((p, i) => ({
        project: details[i].project,
        assignments: details[i].assignments,
        angles: details[i].angles,
        pending: pending[i],
      }))
    );
    setArchived(archivedList);
    onPendingCount(pending.reduce((sum, arr) => sum + arr.length, 0));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, reloadTick]);

  useEffect(() => {
    // Team-view-only panel (below) -- don't bother fetching it in My view.
    if (scope === "team") api.get<CapacityRankRow[]>("/capacity-ranking").then(setRankRows);
  }, [scope, reloadTick, demoHour]);

  const resolveRequest = async (id: string) => {
    await api.patch(`/goal-change-requests/${id}/resolve`);
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
  // New project status — Idle: "parked, waiting on something external,
  // nothing to do now." One-tap either direction, right from the card.
  const idleProject = async (id: string) => {
    await api.post(`/projects/${id}/idle`);
    onReload();
  };
  const reactivateProject = async (id: string) => {
    await api.post(`/projects/${id}/reactivate`);
    onReload();
  };

  if (!items) return <div className="empty">Loading…</div>;

  // §8 Team view — grouped by person, not just a wider flat list: one
  // section per team member (including those leading nothing), each
  // showing only the projects that member leads.
  const teamMembers =
    scope === "team" ? [...people].filter((p) => p.teamId === actor.teamId).sort((a, b) => a.name.localeCompare(b.name)) : [];

  // Phase D, item 5 — the running-list team roster is always the actor's own
  // team, independent of the My view/Team view scope toggle (which only
  // filters project cards, not this overview strip).
  const myTeamRanked = (rankRows ?? [])
    .filter((r) => people.find((p) => p.id === r.personId)?.teamId === actor.teamId)
    .sort((a, b) => a.load - b.load);

  // §8.1 — end-of-day nudge: the actor's OWN active led projects whose
  // calls_sold hasn't been touched today, regardless of scope (Team view
  // can list teammates' projects the actor can't edit, so this always
  // narrows to the actor's own, same set "mine" scope would show).
  const myStaleProjects = items.filter((it) => it.project.plId === actor.id && it.project.needsCallsSoldUpdate);

  // §6/§8 — one assignee's own row: name, progress, stage/timer/back/advance.
  // Shared between the single-angle (flat list) and multi-angle (grouped)
  // renderings below, so there's exactly one place this markup lives.
  const renderAssigneeRow = (a: Assignment) => {
    const elapsed = nowMs - new Date(a.stageEnteredAt).getTime();
    return (
      <div key={a.id} className="assignee-block">
        <div className="assignee">
          <div className="avatar">{initials(nameOf(a.delivererId))}</div>
          <div>
            <div className="assignee-name">
              {nameOf(a.delivererId)} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {practiceOf(a.delivererId)}</span>
            </div>
            <div className="assignee-sub">{a.customDelivered > 0 ? `Incl. ${a.customDelivered} custom` : "No custom"}</div>
          </div>
          <AssigneeGoalEditor assignment={a} onSave={onReload} />
        </div>
        {/* §6/§8 — this assignee's own stage, timer, and the phase dropdown (per-deliverer, domain change 8). */}
        <div className="assignee-actions-row">
          {/* (bug fix, three-across) the adjacent stage-pill already
              names the stage, so the timer chip doesn't repeat it --
              frees up enough width for this row to stay on one line. */}
          <span className={"stage-pill " + stageClass(a.stage)}>{stageLabel(a.stage)}</span>
          <span className={"chip timer " + timerClass(elapsed)}>⏱ {fmtElapsed(elapsed)}</span>
          <StageDropdown assignment={a} onSave={onReload} />
        </div>
      </div>
    );
  };

  const renderCard = ({ project: p, assignments, angles }: ProjectItem) => {
        const { goal, done, pct } = projStats(assignments);
        const pace = paceInfo(pct, p.earliestStage ?? "First Deliverable");
        const ps = poolState(p.expertPool, effectiveHour);
        // §8.1 (corrected) — computed server-side, per angle then OR'd; never
        // re-derived here from summed totals (see rules/project.ts for why).
        const chase = p.chaseClient;
        const multiAngle = angles.length > 1;
        // New project status — idle: visually distinct, excluded from active
        // pacing (server already zeroes chase/needsCallsSoldUpdate for it).
        const isIdle = p.status === "idle";

        return (
          <div key={p.id} className={"card" + (isIdle ? " idle" : "")}>
            {/* Phase D (v2), item 7 — header block tinted by client_entity
                (display map only, §format.ts CLIENT_ENTITY_MAP -- the stored
                clientEntity smallint is untouched). A soft wash, not a full
                colour fill: header text/badge contrast is unaffected since
                all five tints are pale and text stays var(--ink)/pill-own
                colours; "Behind"/chase-client render lower in the card, on
                the plain white body, never inside this tinted block. */}
            <div className="card-top" style={{ background: entityTint(p.clientEntity) }}>
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
                {ps === "live" ? " · Live 2×" : ps === "dormant" ? " · Asleep" : ""}
              </div>
              <div className="chip">
                Sold <b>{p.callsSold}</b>
              </div>
            </div>
            <div className="progress">
              <div className="progress-top">
                <span className="progress-num">
                  {done}
                  <small> / {goal} profiles</small>
                </span>
                <span className="mono" style={{ fontSize: 12, color: "var(--soft)" }}>
                  Goal {p.goalTotal}
                </span>
              </div>
              <div className="bar">
                <span style={{ width: pct + "%", background: barColor(pct) }} />
              </div>
            </div>
            {/* Phase D, items 2/3 — per-angle remaining goal + remaining calls
                sold ("N of M sold"), plus a sold-attainment pulse bar under
                the existing profiles/goal bar above. No bar at all for a
                no-calls Pitch angle (callsN === 0) -- there's nothing to
                divide, and an empty/red bar would misread as behind. */}
            <div className="angle-progress-list">
              {angles.map((ang) => {
                const angleAssignments = assignments.filter((a) => a.angleId === ang.id);
                const angleDelivered = angleAssignments.reduce((s, a) => s + a.delivered + a.customDelivered, 0);
                const remainingGoal = Math.max(ang.goalTotal - angleDelivered, 0);
                const attainment = ang.callsN > 0 ? ang.callsSold / ang.callsN : null;
                return (
                  <div key={ang.id} className="angle-progress-row">
                    <div className="angle-progress-stats">
                      {multiAngle && <span className="angle-progress-name">{ang.name}</span>}
                      <span>{remainingGoal} to goal</span>
                      {ang.callsN > 0 && (
                        <span>
                          {ang.callsSold} of {ang.callsN} sold
                        </span>
                      )}
                    </div>
                    {attainment !== null && (
                      <div className="sold-pulse-bar">
                        <span style={{ width: Math.min(100, attainment * 100) + "%", background: soldBarColor(attainment) }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="stage-row">
              {/* New project status — idle is excluded from active pacing
                  entirely: no pace dot, no chase flag, just the parked badge. */}
              {isIdle ? (
                <span className="idle-badge">⏸ Idle</span>
              ) : (
                <>
                  {/* BUG 2 (fixed) — stage is per-deliverer now (§3/§8); the
                      rolled-up "Earliest: X" project-level label doesn't need
                      surfacing here — each assignee below shows their own. Only
                      the unstaffed case is still worth a pill (that's staffing
                      status, not a stage). */}
                  {!p.earliestStage && <span className="stage-pill stage-selling">Not yet staffed</span>}
                  {chase && (
                    <span className="chip" style={{ color: "#A82F2F", background: "var(--red-bg)" }}>
                      Delivered, not sold — chase client
                    </span>
                  )}
                  {p.earliestStage && (
                    <span className="pace" style={{ color: pace.color }}>
                      <span className="dot" style={{ background: pace.color }} />
                      {pace.label}
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="assignees">
              {/* Big structural change — group assignees under their angle
                  only when there's more than one; a single-angle ("simple")
                  project renders the exact same flat list as before, no
                  angle chrome at all. */}
              {multiAngle
                ? angles.map((ang, i) => {
                    const angleAssignments = assignments.filter((a) => a.angleId === ang.id);
                    return (
                      <div key={ang.id} className={"angle-group" + (i === 0 ? " angle-group-first" : "")}>
                        <div className="angle-group-header">
                          {ang.name}
                          <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--soft)" }}>
                            N {ang.callsN} · Goal {ang.goalTotal}
                          </span>
                        </div>
                        {angleAssignments.length === 0 ? (
                          <div className="empty" style={{ padding: "6px 0 10px", fontSize: 12 }}>
                            Unstaffed
                          </div>
                        ) : (
                          angleAssignments.map(renderAssigneeRow)
                        )}
                      </div>
                    );
                  })
                : assignments.map(renderAssigneeRow)}
            </div>
            {/* Phase D (v2), item 12 — exactly two logical action rows, with
                a divider between them (same weight/colour as the header
                divider, item 6 -- no new style introduced). Row 1: manage
                the project's set-up. Row 2: manage its lifecycle. */}
            <div className="actions">
              <button className="btn btn-pl" onClick={() => onEditTeam(p.id)}>
                Edit team
              </button>
              <button className="btn btn-ghost" onClick={() => onEditProject(p.id)} title="Edit project set-up">
                ✏️ Edit
              </button>
              <CallsSoldEditor angles={angles} onSave={onReload} />
            </div>
            <div className="actions actions-row2">
              <button className="btn btn-ghost" onClick={() => onNotes({ projectId: p.id })}>
                📝 Notes
              </button>
              {/* New project status — Idle: park from the card (one tap),
                  reactivate with one tap once parked. */}
              {isIdle ? (
                <button className="btn btn-pl" onClick={() => reactivateProject(p.id)}>
                  ▶ Reactivate
                </button>
              ) : (
                <button className="btn btn-ghost" onClick={() => idleProject(p.id)}>
                  ⏸ Idle
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => archiveProject(p.id)}>
                Archive
              </button>
            </div>
          </div>
        );
  };

  // Manager feedback batch, item 1 — no more grouping cards into rows by
  // Client Entity; one continuous ordered list instead. The header tint
  // (entityTint(), unchanged) is now the ONLY entity signal. Ordering itself
  // is out of scope for this batch (a separate one) — this just stops
  // re-bucketing the list, preserving whatever order `list` already arrives
  // in.
  const renderCards = (list: ProjectItem[]) => <div className="card-grid">{list.map(renderCard)}</div>;

  return (
    <div className="pl-board-layout">
      <div className="pl-board-main">
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
                    renderCards(personItems)
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
            {renderCards(items)}
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
      </div>

      {/* Phase D, item 5 — small team-overview panel: Name, Load, Free/Not
          only. Team view only (this is "who else on my team is free right
          now," not relevant while looking at just your own projects).
          Reuses GET /capacity-ranking's own personLoad and median-based free
          computation verbatim (rules/load.ts) -- no new definitions here,
          just a narrower, PL-page-local view of them. A thin side panel, not
          a full-width table -- it's a short list of rows, not a lot of text. */}
      {scope === "team" && myTeamRanked.length > 0 && (
        <aside className="team-capacity-panel">
          <div className="team-capacity-header">Team capacity</div>
          {myTeamRanked.map((r) => (
            <div key={r.personId} className="team-capacity-row">
              <div className="avatar">{initials(nameOf(r.personId))}</div>
              <span className="team-capacity-name">{nameOf(r.personId)}</span>
              <span className="team-capacity-load">{r.load.toFixed(1)}</span>
              {!r.eligible ? (
                <span className="mini off">Off</span>
              ) : r.free ? (
                <span className="mini free">Free</span>
              ) : (
                <span className="mini busy">Busy</span>
              )}
            </div>
          ))}
        </aside>
      )}
    </div>
  );
}
