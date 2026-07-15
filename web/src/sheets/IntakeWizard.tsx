import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { ExpertPool, RankedCandidate } from "../api/types";
import Sheet from "../components/Sheet";
import { initials, previewCustomGoal } from "../lib/format";
import { useApp } from "../state/AppContext";

const POOLS: ExpertPool[] = ["Global", "EU & MEA & India", "AUS / NZ / Sing / JP", "US only"];
const TYPES = ["Pitch", "Due Diligence", "Strategy"] as const;

/** Required at intake (bug fix) — mirrors the server's own check (never trust client-side validation alone). */
function isValidHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

interface FormState {
  client: string;
  account: string;
  topic: string;
  link: string;
  projectType: (typeof TYPES)[number];
  expertPool: ExpertPool;
  callsN: string;
}

/** §5a (eight changes, domain change 4) — the formula actually used, shown so a deliverer can always see why their goal is what it is. */
function goalCalcText(projectType: FormState["projectType"], callsN: number, goal: number): string {
  if (projectType === "Pitch" && callsN === 0) {
    return `No calls agreed yet (N=0) → flat preview goal of ${goal}. Converts to normal Strategy rules the moment calls are agreed.`;
  }
  if (projectType === "Due Diligence") {
    return `${callsN} calls (N) × 3 (Due Diligence — heavier than Strategy) → ${goal} profiles`;
  }
  if (projectType === "Pitch") {
    return `${callsN} calls (N) → ${goal} profiles — converted to Strategy rules now that calls are agreed`;
  }
  const mult = callsN <= 2 ? 3 : 2;
  return `${callsN} calls (N) × ${mult} (Strategy) → ${goal} profiles`;
}

export default function IntakeWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { nameOf, practiceOf, effectiveAfterHours, sunday } = useApp();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [f, setF] = useState<FormState>({
    client: "",
    account: "",
    topic: "",
    link: "",
    projectType: "Pitch",
    expertPool: "Global",
    callsN: "0",
  });
  const [goalTotal, setGoalTotal] = useState(0);
  const [staffCount, setStaffCount] = useState(1);
  const [matching, setMatching] = useState(false);
  const [ranked, setRanked] = useState<RankedCandidate[] | null>(null);
  const [picked, setPicked] = useState<RankedCandidate[]>([]);
  // §6 (eight changes) — personId -> justification, for anyone in `picked`
  // the PL manually chose instead of who auto-match/ranking suggested.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [overridingId, setOverridingId] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState("");
  const [justificationText, setJustificationText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const callsN = Number(f.callsN) || 0;
  const minCallsN = f.projectType === "Pitch" ? 0 : 1;

  const goSuggest = async () => {
    setError(null);
    try {
      const res = await api.post<{ goal: number; staffing: { delivererCount: number } }>("/projects/intake/suggest", {
        callsN,
        projectType: f.projectType,
      });
      setGoalTotal(res.goal);
      setStaffCount(res.staffing.delivererCount);
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not compute a suggestion");
    }
  };

  const runMatch = async () => {
    setStep(3);
    setMatching(true);
    setError(null);
    setOverrides({});
    try {
      // staffCount is authoritative server-side (autoMatch()) — whatever the
      // PL set here is exactly who gets picked, not re-derived client-side.
      const res = await api.post<{ ranked: RankedCandidate[]; picked: RankedCandidate[] }>("/projects/intake/match", {
        staffCount,
      });
      setRanked(res.ranked);
      setPicked(res.picked);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run matching");
    } finally {
      setMatching(false);
    }
  };

  // §6 (eight changes) — override the auto-match: pick anyone currently free
  // instead of one of the auto-picked candidates. Requires a justification.
  const startOverride = (candidateId: string) => {
    setOverridingId(candidateId);
    setReplaceTarget(picked[0]?.personId ?? "");
    setJustificationText("");
  };
  const confirmOverride = () => {
    if (!overridingId || !replaceTarget || !justificationText.trim()) return;
    const candidate = ranked?.find((r) => r.personId === overridingId);
    if (!candidate) return;
    setPicked((prev) => prev.map((p) => (p.personId === replaceTarget ? candidate : p)));
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[replaceTarget];
      next[overridingId] = justificationText.trim();
      return next;
    });
    setOverridingId(null);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const perPerson = Math.ceil(goalTotal / (picked.length || 1));
      await api.post("/projects", {
        client: f.client || "New client",
        account: f.account || undefined,
        topic: f.topic || "Untitled",
        projectLink: f.link,
        projectType: f.projectType,
        expertPool: f.expertPool,
        callsN,
        goalTotal,
        // custom_goal is never sent — the server always derives it from goal.
        assignments: picked.map((r) => ({
          delivererId: r.personId,
          goal: perPerson,
          ...(overrides[r.personId] ? { override: { justification: overrides[r.personId] } } : {}),
        })),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the project");
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} desktopVariant="dialog">
      {error && <div className="err-line">{error}</div>}

        {step === 1 && (
          <>
            <h2>New project</h2>
            <div className="sub">Relay estimates the sourcing goal and auto-staffs it.</div>
            <div className="field">
              <label>Client</label>
              <input value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} placeholder="e.g. Client_A" />
            </div>
            <div className="field">
              <label>Topic / account</label>
              <input value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} placeholder="e.g. Market sizing" />
            </div>
            <div className="field">
              <label>N — calls the client wants{f.projectType === "Pitch" ? " (0 if none agreed yet)" : ""}</label>
              <input
                type="number"
                min={minCallsN}
                value={f.callsN}
                onChange={(e) => setF({ ...f, callsN: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Project type</label>
              <div className="pick">
                {TYPES.map((t) => (
                  <button
                    key={t}
                    className={f.projectType === t ? "sel" : ""}
                    onClick={() => setF({ ...f, projectType: t, callsN: t !== "Pitch" && f.callsN === "0" ? "2" : f.callsN })}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {f.projectType === "Pitch" && (
                <p style={{ fontSize: 11, color: "var(--soft)", margin: "6px 0 0" }}>
                  A preview list — usually no calls agreed yet. N=0 is fine.
                </p>
              )}
              {f.projectType === "Due Diligence" && (
                <p style={{ fontSize: 11, color: "var(--soft)", margin: "6px 0 0" }}>
                  N is typically high and sourcing is harder — goal is heavier than Strategy at the same N.
                </p>
              )}
            </div>
            <div className="field">
              <label>Expert timezone pool</label>
              <select value={f.expertPool} onChange={(e) => setF({ ...f, expertPool: e.target.value as ExpertPool })}>
                {POOLS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Project link</label>
              <input value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://..." />
              {f.link.length > 0 && !isValidHttpUrl(f.link) && (
                <p style={{ fontSize: 11, color: "#A82F2F", margin: "6px 0 0" }}>
                  Must be a valid http(s) link — this is what the project's name links to everywhere it appears.
                </p>
              )}
            </div>
            <div className="sheet-footer">
              <button
                className="btn btn-pl"
                style={{ width: "100%" }}
                disabled={!f.client || callsN < minCallsN || !isValidHttpUrl(f.link)}
                onClick={goSuggest}
              >
                Estimate goal →
              </button>
              <button className="close" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Suggested plan</h2>
            <div className="sub">You own these numbers — adjust before confirming.</div>
            <div className="suggest">
              <div className="suggest-lbl">Goal — profiles to source</div>
              <div className="suggest-big">{goalTotal}</div>
              <div className="suggest-calc">{goalCalcText(f.projectType, callsN, goalTotal)}</div>
              <div className="suggest-edit">
                <span style={{ fontSize: 12, fontWeight: 600 }}>Adjust goal</span>
                <div className="step" style={{ marginLeft: "auto" }}>
                  <button onClick={() => setGoalTotal((g) => Math.max(1, g - 1))}>−</button>
                  <span className="val">{goalTotal}</span>
                  <button onClick={() => setGoalTotal((g) => g + 1)}>+</button>
                </div>
              </div>
            </div>
            {f.projectType === "Pitch" && callsN === 0 && (
              <p style={{ fontSize: 11, color: "var(--soft)", margin: "-6px 0 12px" }}>
                Load for this project is pinned at a flat 1 while no calls are agreed — it won't consume capacity proportionally.
              </p>
            )}
            <div className="suggest" style={{ background: "var(--dl-soft)", borderColor: "#B9E3DC" }}>
              <div className="suggest-lbl" style={{ color: "var(--dl)" }}>
                Delivering associates to staff
              </div>
              <div className="suggest-edit">
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  {staffCount} {staffCount > 1 ? "people" : "person"} · ~{Math.ceil(goalTotal / staffCount)} each, incl.{" "}
                  {previewCustomGoal(Math.ceil(goalTotal / staffCount))} custom (auto)
                </span>
                <div className="step" style={{ marginLeft: "auto" }}>
                  <button onClick={() => setStaffCount((c) => Math.max(1, c - 1))}>−</button>
                  <span className="val">{staffCount}</span>
                  <button onClick={() => setStaffCount((c) => c + 1)}>+</button>
                </div>
              </div>
            </div>
            <div className="sheet-footer">
              <button className="btn btn-pl" style={{ width: "100%" }} onClick={runMatch}>
                Find who's first up →
              </button>
              <button className="close" onClick={() => setStep(1)}>
                ← Back
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>{matching ? "Finding who's first up…" : "Auto-matched"}</h2>
            <div className="sub">
              {matching
                ? "Ranking by current load."
                : sunday
                ? "Sunday — only people on today's rota are eligible."
                : effectiveAfterHours
                ? "After hours — evening-coverage volunteers only."
                : "Working hours — all available staff."}
            </div>
            {!matching && (
              <div className="match-hint">
                Soft rule: prefers your practice area when they're free — remaining profiles at or below the org-wide median.
                Not who you want? Click "Pick instead" on anyone else free below (needs a reason).
              </div>
            )}
            {matching && (
              <div style={{ textAlign: "center", padding: 30, fontFamily: "'Space Grotesk'", color: "var(--soft)" }}>ranking…</div>
            )}
            {!matching && ranked && picked.length === 0 && (
              <div className="suggest" style={{ background: "var(--amber-bg)", borderColor: "#F0DCB0" }}>
                <div className="suggest-lbl" style={{ color: "#9A5F0C" }}>
                  No one available now
                </div>
                <p style={{ fontSize: 13, margin: "6px 0 0", color: "var(--ink)" }}>
                  It'll go to the open pool — eligible people can accept or decline.
                </p>
              </div>
            )}
            {!matching &&
              ranked?.slice(0, 8).map((r) => {
                const isPicked = picked.some((p) => p.personId === r.personId);
                const isOverridden = !!overrides[r.personId];
                return (
                  <div key={r.personId} className={"match-line " + (isPicked ? "picked " : "") + (r.eligible ? "" : "blocked")}>
                    <div className="avatar">{initials(nameOf(r.personId))}</div>
                    <div>
                      <div className="assignee-name">
                        {nameOf(r.personId)} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {practiceOf(r.personId)}</span>
                      </div>
                      <div className="assignee-sub">
                        {!r.eligible
                          ? r.ineligibleReason === "not_on_sunday_rota"
                            ? "not on today's Sunday rota"
                            : "evening coverage off"
                          : isPicked
                          ? <span className="picktag">picked ✓{isOverridden ? " · override" : r.practiceAreaMatch ? " · your practice" : ""}</span>
                          : r.free
                          ? "free"
                          : "available"}
                      </div>
                    </div>
                    <div className="load-score">
                      <b>{r.load.toFixed(1)}</b>
                      <small>load</small>
                    </div>
                    {!isPicked && r.eligible && picked.length > 0 && (
                      <button className="btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={() => startOverride(r.personId)}>
                        Pick instead
                      </button>
                    )}
                  </div>
                );
              })}

            {overridingId && (
              <div className="suggest" style={{ marginTop: 10 }}>
                <div className="suggest-lbl">Override — pick {nameOf(overridingId)} instead of…</div>
                {picked.length > 1 ? (
                  <select
                    value={replaceTarget}
                    onChange={(e) => setReplaceTarget(e.target.value)}
                    style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)", margin: "8px 0", fontSize: 13, color: "var(--ink)" }}
                  >
                    {picked.map((p) => (
                      <option key={p.personId} value={p.personId}>
                        {nameOf(p.personId)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p style={{ fontSize: 12, margin: "8px 0", color: "var(--ink)" }}>{nameOf(replaceTarget)}</p>
                )}
                <div className="field">
                  <label>Justification — required to pick someone other than suggested</label>
                  <input
                    value={justificationText}
                    onChange={(e) => setJustificationText(e.target.value)}
                    placeholder="e.g. client specifically asked for this person"
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost" onClick={() => setOverridingId(null)}>
                    Cancel
                  </button>
                  <button className="btn btn-pl" disabled={!justificationText.trim()} onClick={confirmOverride}>
                    Confirm override
                  </button>
                </div>
              </div>
            )}

            {!matching && (
              <div className="sheet-footer">
                <button className="btn btn-pl" style={{ width: "100%" }} disabled={busy} onClick={confirm}>
                  {picked.length ? `Assign ${picked.length} & notify` : "Post to open pool"}
                </button>
                <button className="close" onClick={() => setStep(2)}>
                  ← Back
                </button>
              </div>
            )}
          </>
        )}
    </Sheet>
  );
}
