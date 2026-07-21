import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Angle, Assignment, Project, RankedCandidate } from "../api/types";
import Sheet from "../components/Sheet";
import { initials } from "../lib/format";
import { useApp } from "../state/AppContext";

type Action =
  | { mode: "swap"; assignmentId: string; currentDelivererId: string }
  | { mode: "add"; angleId: string | null };

/**
 * §3/§6 (eight changes) — "Edit team": change deliverers on a project and add
 * new ones (BUG 3 — this is what "Edit goals" used to be misnamed as, before
 * it actually did this). Picking anyone other than the auto-suggested top
 * candidate is an override (§6) and requires a written justification, logged
 * to the audit trail server-side — never a notification about the override
 * itself.
 *
 * Big structural change — assignments attach to an angle now. Adding a
 * deliverer to a single-angle ("simple") project needs no angle chrome at
 * all (silently targets that one angle, exactly like before); a multi-angle
 * project asks which angle first.
 */
export default function TeamEditSheet({
  projectId,
  onClose,
  onChanged,
}: {
  projectId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { nameOf, practiceOf, people } = useApp();
  const [project, setProject] = useState<Project | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [angles, setAngles] = useState<Angle[] | null>(null);
  const [ranked, setRanked] = useState<RankedCandidate[] | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [justification, setJustification] = useState("");
  const [addGoal, setAddGoal] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const detail = await api.get<{ project: Project; assignments: Assignment[]; angles: Angle[] }>(
      `/projects/${projectId}`
    );
    setProject(detail.project);
    setAssignments(detail.assignments);
    setAngles(detail.angles);
    // Pre-existing bug fix (unrelated to this batch, discovered while
    // verifying it live): the server has always required a non-empty
    // `angles` array here (`at least one angle is required`) -- this call
    // never sent one, so /intake/match 400'd on every load and the sheet
    // hung on "Loading…" forever. Only `ranked` (the org-wide candidate
    // list) is used below; `perAngle`/`totalEligible` from the response are
    // ignored, so a single dummy angle entry is enough to satisfy validation.
    const match = await api.post<{ ranked: RankedCandidate[] }>("/projects/intake/match", {
      angles: [{ key: "0", staffCount: 1 }],
    });
    setRanked(match.ranked);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (!project || !assignments || !angles || !ranked) {
    return (
      <Sheet onClose={onClose}>
        <div className="empty">Loading…</div>
      </Sheet>
    );
  }

  const multiAngle = angles.length > 1;
  // Exclusion is per-ANGLE, not per-project: one person may hold seats on two
  // different angles of the same project (the DB uniqueness is (angle,
  // deliverer)). Only people already on the TARGET angle are hidden.
  const targetAngleId =
    action?.mode === "swap"
      ? assignments.find((x) => x.id === action.assignmentId)?.angleId ?? null
      : action?.mode === "add"
      ? action.angleId
      : null;
  const onTargetAngle = new Set(assignments.filter((x) => x.angleId === targetAngleId).map((x) => x.delivererId));
  const onOtherAngles = new Set(assignments.filter((x) => x.angleId !== targetAngleId).map((x) => x.delivererId));
  const candidates = ranked.filter((r) => !onTargetAngle.has(r.personId));
  const suggestedId = candidates.find((r) => r.eligible)?.personId;
  // Managers are excluded from the ranked candidate pool entirely (never
  // suggested, never auto-picked — see services/candidates.ts), so they
  // can't come from `ranked`. They're still manually staffable: rendered as
  // a separate section below, sourced from the plain people list already
  // loaded client-side, always resolving to an override (a manager can never
  // equal `suggestedId`, since they were never in `ranked` to begin with).
  const managers = people.filter(
    (p) => (p.isManager || p.isOwner) && p.status === "Available" && !p.deactivatedAt && !onTargetAngle.has(p.id)
  );

  const startSwap = (a: Assignment) => {
    setAction({ mode: "swap", assignmentId: a.id, currentDelivererId: a.delivererId });
    setSelectedId(null);
    setJustification("");
    setError(null);
  };
  const goalForAngle = (angleId: string) => {
    const angle = angles.find((a) => a.id === angleId);
    const angleAssignmentCount = assignments.filter((a) => a.angleId === angleId).length;
    return Math.max(1, Math.ceil((angle?.goalTotal ?? 1) / (angleAssignmentCount + 1)));
  };
  const startAdd = () => {
    if (multiAngle) {
      setAction({ mode: "add", angleId: null });
    } else {
      setAction({ mode: "add", angleId: angles[0].id });
      setAddGoal(goalForAngle(angles[0].id));
    }
    setSelectedId(null);
    setJustification("");
    setError(null);
  };
  const pickAngleForAdd = (angleId: string) => {
    setAction({ mode: "add", angleId });
    setAddGoal(goalForAngle(angleId));
  };
  const cancelAction = () => {
    setAction(null);
    setSelectedId(null);
    setJustification("");
  };

  const isOverride = selectedId != null && selectedId !== suggestedId;

  const confirm = async () => {
    if (!action || !selectedId) return;
    if (action.mode === "add" && !action.angleId) return;
    setBusy(true);
    setError(null);
    try {
      // Optional since 2026-07-21: an override no longer demands a written
      // reason. The override itself is still always audit-logged server-side;
      // any text typed here is recorded with it.
      const override = isOverride ? (justification.trim() ? { justification: justification.trim() } : {}) : undefined;
      if (action.mode === "swap") {
        await api.post(`/assignments/${action.assignmentId}/swap`, { newDelivererId: selectedId, override });
      } else {
        await api.post(`/projects/${projectId}/assignments`, {
          angleId: action.angleId,
          delivererId: selectedId,
          goal: addGoal,
          override,
        });
      }
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the team change");
      setBusy(false);
    }
  };

  const angleName = (angleId: string) => angles.find((a) => a.id === angleId)?.name ?? "";

  return (
    <Sheet onClose={onClose}>
      <h2>Edit team</h2>
      <div className="sub">{project.client} — change deliverers or add new ones.</div>
      {error && <div className="err-line">{error}</div>}

      {!action && (
        <>
          <div className="section-lbl spaced">Current team</div>
          {assignments.map((a) => (
            <div key={a.id} className="match-line">
              <div className="avatar">{initials(nameOf(a.delivererId))}</div>
              <div>
                <div className="assignee-name">
                  {nameOf(a.delivererId)} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {practiceOf(a.delivererId)}</span>
                </div>
                <div className="assignee-sub">
                  {multiAngle ? `${a.angleName} · ` : ""}
                  goal {a.goal} · {a.delivered + a.customDelivered} delivered
                </div>
              </div>
              <button className="btn-sm btn-pl" style={{ marginLeft: "auto" }} onClick={() => startSwap(a)}>
                Change
              </button>
            </div>
          ))}
          <div className="sheet-footer">
            <button className="btn btn-pl" style={{ width: "100%" }} onClick={startAdd}>
              + Add deliverer
            </button>
            <button className="close" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}

      {action && action.mode === "add" && !action.angleId && (
        <>
          <div className="section-lbl spaced">Which angle?</div>
          {angles.map((ang) => (
            <button
              key={ang.id}
              className="match-line"
              style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
              onClick={() => pickAngleForAdd(ang.id)}
            >
              <div>
                <div className="assignee-name">{ang.name}</div>
                <div className="assignee-sub">
                  N {ang.callsN} · goal {ang.goalTotal} · {assignments.filter((a) => a.angleId === ang.id).length} staffed
                </div>
              </div>
            </button>
          ))}
          <div className="sheet-footer">
            <button className="close" onClick={cancelAction}>
              ← Back
            </button>
          </div>
        </>
      )}

      {action && (action.mode === "swap" || action.angleId) && (
        <>
          <div className="section-lbl spaced">
            {action.mode === "swap" ? `Replace ${nameOf(action.currentDelivererId)}` : `Add a deliverer — ${angleName(action.angleId!)}`}
          </div>
          {action.mode === "add" && (
            <div className="suggest" style={{ marginBottom: 12 }}>
              <div className="suggest-edit">
                <span style={{ fontSize: 12, fontWeight: 600 }}>Goal for this deliverer</span>
                <div className="step" style={{ marginLeft: "auto" }}>
                  <button onClick={() => setAddGoal((g) => Math.max(1, g - 1))}>−</button>
                  <span className="val">{addGoal}</span>
                  <button onClick={() => setAddGoal((g) => g + 1)}>+</button>
                </div>
              </div>
            </div>
          )}
          {/* Blocked candidates are selectable too — they can never be the
              suggestion, so picking one is automatically an override (reason
              optional, logged), same treatment as managers below. */}
          {candidates.map((r) => (
            <div
              key={r.personId}
              className={"match-line " + (r.eligible ? "" : "blocked") + (selectedId === r.personId ? " picked" : "")}
              onClick={() => setSelectedId(r.personId)}
              style={{ cursor: "pointer" }}
            >
              <div className="avatar">{initials(nameOf(r.personId))}</div>
              <div>
                <div className="assignee-name">
                  {nameOf(r.personId)} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {practiceOf(r.personId)}</span>
                  {r.personId === suggestedId && <span className="picktag" style={{ marginLeft: 6 }}>Suggested</span>}
                </div>
                <div className="assignee-sub">
                  {!r.eligible
                    ? r.ineligibleReason === "not_on_sunday_rota"
                      ? "Not on today's rota"
                      : "Evening coverage off"
                    : r.free
                    ? "Free"
                    : "Available"}
                  {onOtherAngles.has(r.personId) ? " · already on another angle of this project" : ""}
                </div>
              </div>
              <div className="load-score" style={{ marginLeft: "auto" }}>
                <b>{r.load.toFixed(1)}</b>
                <small>Load</small>
              </div>
            </div>
          ))}
          {candidates.length === 0 && <div className="empty">No other candidates.</div>}

          {managers.length > 0 && (
            <>
              <div className="section-lbl spaced">Or add a manager (never suggested — always a manual pick)</div>
              {managers.map((m) => (
                <div
                  key={m.id}
                  className={"match-line " + (selectedId === m.id ? " picked" : "")}
                  onClick={() => setSelectedId(m.id)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="avatar">{initials(m.name)}</div>
                  <div>
                    <div className="assignee-name">
                      {m.name} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {m.practiceArea}</span>
                    </div>
                    <div className="assignee-sub">Manager</div>
                  </div>
                </div>
              ))}
            </>
          )}

          <div className="sheet-footer">
            {/* The justification lives HERE, next to the button it unlocks —
                it used to render above, after the full candidate + manager
                lists, where picking someone near the top left it scrolled out
                of view: the confirm button then sat disabled with no visible
                reason (the "cursor shows blocked" bug). */}
            {isOverride && (
              <div className="field">
                <label>Justification — optional, saved to the audit trail if you add one</label>
                <input
                  autoFocus
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="e.g. client asked for this specific person"
                />
              </div>
            )}
            <button
              className="btn btn-pl"
              style={{ width: "100%" }}
              disabled={!selectedId || busy}
              title={!selectedId ? "Pick a person first" : undefined}
              onClick={confirm}
            >
              {isOverride ? "Confirm override" : "Confirm"}
            </button>
            <button className="close" onClick={cancelAction}>
              ← Back
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
