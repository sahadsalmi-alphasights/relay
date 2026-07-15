import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Assignment, Project, RankedCandidate } from "../api/types";
import Sheet from "../components/Sheet";
import { initials } from "../lib/format";
import { useApp } from "../state/AppContext";

type Action = { mode: "swap"; assignmentId: string; currentDelivererId: string } | { mode: "add" };

/**
 * §3/§6 (eight changes) — "Edit team": change deliverers on a project and add
 * new ones (BUG 3 — this is what "Edit goals" used to be misnamed as, before
 * it actually did this). Picking anyone other than the auto-suggested top
 * candidate is an override (§6) and requires a written justification, logged
 * to the audit trail server-side — never a notification about the override
 * itself.
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
  const { nameOf, practiceOf } = useApp();
  const [project, setProject] = useState<Project | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [ranked, setRanked] = useState<RankedCandidate[] | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [justification, setJustification] = useState("");
  const [addGoal, setAddGoal] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const detail = await api.get<{ project: Project; assignments: Assignment[] }>(`/projects/${projectId}`);
    setProject(detail.project);
    setAssignments(detail.assignments);
    const match = await api.post<{ ranked: RankedCandidate[] }>("/projects/intake/match", { staffCount: 1 });
    setRanked(match.ranked);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (!project || !assignments || !ranked) {
    return (
      <Sheet onClose={onClose}>
        <div className="empty">Loading…</div>
      </Sheet>
    );
  }

  const alreadyOnProject = new Set(assignments.map((a) => a.delivererId));
  const candidates = ranked.filter((r) => !alreadyOnProject.has(r.personId));
  const suggestedId = candidates.find((r) => r.eligible)?.personId;

  const startSwap = (a: Assignment) => {
    setAction({ mode: "swap", assignmentId: a.id, currentDelivererId: a.delivererId });
    setSelectedId(null);
    setJustification("");
    setError(null);
  };
  const startAdd = () => {
    setAction({ mode: "add" });
    setSelectedId(null);
    setJustification("");
    setAddGoal(Math.max(1, Math.ceil(project.goalTotal / (assignments.length + 1))));
    setError(null);
  };
  const cancelAction = () => {
    setAction(null);
    setSelectedId(null);
    setJustification("");
  };

  const isOverride = selectedId != null && selectedId !== suggestedId;

  const confirm = async () => {
    if (!action || !selectedId) return;
    if (isOverride && !justification.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const override = isOverride ? { justification: justification.trim() } : undefined;
      if (action.mode === "swap") {
        await api.post(`/assignments/${action.assignmentId}/swap`, { newDelivererId: selectedId, override });
      } else {
        await api.post(`/projects/${projectId}/assignments`, { delivererId: selectedId, goal: addGoal, override });
      }
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the team change");
      setBusy(false);
    }
  };

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

      {action && (
        <>
          <div className="section-lbl spaced">
            {action.mode === "swap" ? `Replace ${nameOf(action.currentDelivererId)}` : "Add a deliverer"}
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
          {candidates.map((r) => (
            <div
              key={r.personId}
              className={"match-line " + (r.eligible ? "" : "blocked") + (selectedId === r.personId ? " picked" : "")}
              onClick={() => r.eligible && setSelectedId(r.personId)}
              style={{ cursor: r.eligible ? "pointer" : "default" }}
            >
              <div className="avatar">{initials(nameOf(r.personId))}</div>
              <div>
                <div className="assignee-name">
                  {nameOf(r.personId)} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {practiceOf(r.personId)}</span>
                  {r.personId === suggestedId && <span className="picktag" style={{ marginLeft: 6 }}>suggested</span>}
                </div>
                <div className="assignee-sub">
                  {!r.eligible
                    ? r.ineligibleReason === "not_on_sunday_rota"
                      ? "not on today's rota"
                      : "evening coverage off"
                    : r.free
                    ? "free"
                    : "available"}
                </div>
              </div>
              <div className="load-score" style={{ marginLeft: "auto" }}>
                <b>{r.load.toFixed(1)}</b>
                <small>load</small>
              </div>
            </div>
          ))}
          {candidates.length === 0 && <div className="empty">No other candidates.</div>}

          {isOverride && (
            <div className="field">
              <label>Justification — required to pick someone other than the suggested candidate</label>
              <input
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="e.g. client asked for this specific person"
              />
            </div>
          )}

          <div className="sheet-footer">
            <button
              className="btn btn-pl"
              style={{ width: "100%" }}
              disabled={!selectedId || busy || (isOverride && !justification.trim())}
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
