import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { ExpertPool, RankedCandidate } from "../api/types";
import Sheet from "../components/Sheet";
import { CLIENT_ENTITY_IDS, entityName, initials, previewCustomGoal } from "../lib/format";
import { useApp } from "../state/AppContext";

const POOLS: ExpertPool[] = ["Global", "EU & MEA & India", "AUS / NZ / Sing / JP", "US only"];
const TYPES = ["Pitch", "Due Diligence", "Strategy"] as const;
const CLIENT_ENTITIES = CLIENT_ENTITY_IDS;

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
  /** New set-up field — groups the PL board into rows, 1-5. */
  clientEntity: (typeof CLIENT_ENTITIES)[number];
}

/**
 * Big structural change — a project always has >=1 angle; a "simple"
 * project is just a project with one. Everything that used to be
 * project-level (N, suggested goal, staffing, matching, overrides) is
 * per-angle now, held as one array entry per angle.
 */
interface AngleForm {
  name: string;
  callsN: string;
  goalTotal: number;
  staffCount: number;
  ranked: RankedCandidate[] | null;
  picked: RankedCandidate[];
  overrides: Record<string, string>;
  /** "Invisible competition" — defaults on; only read for Due Diligence/Strategy angles (never Pitch). */
  invisibleCompetitionEnabled: boolean;
}

function newAngle(callsN: string): AngleForm {
  return {
    name: "",
    callsN,
    goalTotal: 0,
    staffCount: 1,
    ranked: null,
    picked: [],
    overrides: {},
    invisibleCompetitionEnabled: true,
  };
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
  const { nameOf, practiceOf, effectiveAfterHours, sunday, people } = useApp();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [f, setF] = useState<FormState>({
    client: "",
    account: "",
    topic: "",
    link: "",
    projectType: "Pitch",
    expertPool: "Global",
    clientEntity: 1,
  });
  const [angles, setAngles] = useState<AngleForm[]>([newAngle("0")]);
  const [matching, setMatching] = useState(false);
  // CHANGE 1 — how many candidates were eligible at all, across the WHOLE
  // multi-angle request. 0 means the true zero-eligible broadcast case
  // (Change 3); >0 with some angle still short means partial-fill (Change 4).
  const [totalEligible, setTotalEligible] = useState<number | null>(null);
  // Only one override panel open at a time, app-wide -- which angle it's acting on.
  const [overridingAngle, setOverridingAngle] = useState<number | null>(null);
  const [overridingId, setOverridingId] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState("");
  const [justificationText, setJustificationText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Manager feedback batch, item 5 — the override panel (and its
  // justification field) renders below whichever candidate row was clicked,
  // which can be well off-screen in a long ranked list. Scroll it into view
  // the moment it mounts, instead of leaving the user to find it themselves.
  const justificationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (overridingAngle !== null && overridingId) {
      justificationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      justificationRef.current?.focus();
    }
  }, [overridingAngle, overridingId]);

  const minCallsN = f.projectType === "Pitch" ? 0 : 1;
  const multiAngle = angles.length > 1;

  const updateAngle = (index: number, patch: Partial<AngleForm>) => {
    setAngles((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };
  const addAngle = () => {
    setAngles((prev) => [...prev, newAngle(String(minCallsN))]);
  };
  const removeAngle = (index: number) => {
    setAngles((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };
  const angleName = (a: AngleForm, index: number) => a.name.trim() || (index === 0 ? f.topic.trim() || "Main" : `Angle ${index + 1}`);

  const allCallsNValid = angles.every((a) => (Number(a.callsN) || 0) >= minCallsN);

  const goSuggest = async () => {
    setError(null);
    try {
      const results = await Promise.all(
        angles.map((a) =>
          api.post<{ goal: number; staffing: { delivererCount: number } }>("/projects/intake/suggest", {
            callsN: Number(a.callsN) || 0,
            projectType: f.projectType,
          })
        )
      );
      setAngles((prev) =>
        prev.map((a, i) => ({ ...a, goalTotal: results[i].goal, staffCount: results[i].staffing.delivererCount }))
      );
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not compute a suggestion");
    }
  };

  const runMatch = async () => {
    setStep(3);
    setMatching(true);
    setError(null);
    setAngles((prev) => prev.map((a) => ({ ...a, overrides: {} })));
    try {
      // CHANGE 1 — ONE call covering every angle against ONE candidate
      // snapshot, not one call per angle. The old per-angle Promise.all was
      // blind to what other angles picked (nothing had been written to the
      // DB yet to shift anyone's load between calls), so every angle got
      // near-identical top-N suggestions. The server now allocates
      // without replacement across angles, reusing already-placed people
      // only once the eligible pool is exhausted.
      const result = await api.post<{
        ranked: RankedCandidate[];
        perAngle: { key: string; picked: RankedCandidate[] }[];
        totalEligible: number;
        projectStatus: "active" | "open";
      }>("/projects/intake/match", {
        angles: angles.map((a, i) => ({ key: String(i), staffCount: a.staffCount })),
      });
      const pickedByKey = new Map(result.perAngle.map((p) => [p.key, p.picked]));
      // `ranked` is the SAME shared snapshot for every angle now (one
      // ranking, allocated across all of them) — each angle keeps its own
      // copy only because the rendering below already reads `a.ranked`
      // per-angle; it's the identical array reference for all of them.
      setAngles((prev) =>
        prev.map((a, i) => ({ ...a, ranked: result.ranked, picked: pickedByKey.get(String(i)) ?? [] }))
      );
      setTotalEligible(result.totalEligible);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run matching");
    } finally {
      setMatching(false);
    }
  };

  /** CHANGE 1 — which angle (if any, other than `forIndex`) a candidate is already placed on in THIS project, so the UI can show "without replacement" honestly instead of implying they were simply skipped. */
  const placedOnOtherAngle = (personId: string, forIndex: number): string | null => {
    for (let i = 0; i < angles.length; i++) {
      if (i === forIndex) continue;
      if (angles[i].picked.some((p) => p.personId === personId)) return angleName(angles[i], i);
    }
    return null;
  };

  // §6 (eight changes) — override the auto-match: pick anyone currently free
  // instead of one of the auto-picked candidates. Requires a justification.
  const startOverride = (angleIndex: number, candidateId: string) => {
    setOverridingAngle(angleIndex);
    setOverridingId(candidateId);
    setReplaceTarget(angles[angleIndex].picked[0]?.personId ?? "");
    setJustificationText("");
  };
  // Managers are excluded from the ranked candidate pool entirely (never
  // suggested, never auto-picked — see services/candidates.ts). They're
  // still manually staffable: a synthetic RankedCandidate lets a manager
  // pick flow through the exact same override machinery as any other pick.
  const managerAsCandidate = (id: string): RankedCandidate => ({
    personId: id,
    eligible: true,
    load: 0,
    rawRemaining: 0,
    practiceAreaMatch: false,
    free: false,
  });
  const confirmOverride = () => {
    // Justification is optional (2026-07-21); the override is audit-logged either way.
    if (overridingAngle === null || !overridingId) return;
    const angleIndex = overridingAngle;
    const angle = angles[angleIndex];
    // An angle with zero auto-picked candidates ("No one available now") has
    // nothing for `replaceTarget` to name — a manager pick there is an
    // ADD, not a replace. Every other case (including a manager replacing a
    // real pick) still needs a target.
    if (angle.picked.length > 0 && !replaceTarget) return;
    const candidate = angle.ranked?.find((r) => r.personId === overridingId) ?? managerAsCandidate(overridingId);
    const nextPicked =
      angle.picked.length > 0 ? angle.picked.map((p) => (p.personId === replaceTarget ? candidate : p)) : [candidate];
    const nextOverrides = { ...angle.overrides };
    if (replaceTarget) delete nextOverrides[replaceTarget];
    nextOverrides[overridingId] = justificationText.trim();
    updateAngle(angleIndex, { picked: nextPicked, overrides: nextOverrides });
    setOverridingAngle(null);
    setOverridingId(null);
  };

  const totalPicked = angles.reduce((sum, a) => sum + a.picked.length, 0);
  // CHANGE 2 — surfaced prominently at the top of step 3 (moved up from
  // being buried per-row at the bottom of the old flow): candidates blocked
  // by the new first-deliverable rule, shared across every angle (one
  // ranked snapshot). Still overridable — the loosened "Pick instead" gate
  // below lets the PL assign them anyway, with the usual justification.
  const sharedRanked = angles[0]?.ranked ?? null;
  const blockedByFirstDeliverable = sharedRanked?.filter((r) => r.ineligibleReason === "first_deliverable_conflict") ?? [];
  // Copy-only patch — the soft-rule explanation and the first-deliverable
  // block used to be two separate paragraphs, both ending in the same
  // "Pick instead" instruction. One line now; the blocked clause drops
  // entirely at zero rather than rendering "0 blocked".
  const matchHintText =
    `Prefers your practice area when free.` +
    (blockedByFirstDeliverable.length > 0
      ? ` ${blockedByFirstDeliverable.length} blocked (already on a First Deliverable) — listed below, pickable with an override.`
      : "") +
    ` Use "Pick instead" for anyone else (reason optional, logged).`;
  // CHANGE 4 — partial fill: some (not zero, not all) of an angle's wanted
  // seats got filled. Zero eligible anywhere (totalEligible === 0) is
  // Change 3's broadcast case instead, handled by the existing "No one
  // available now" box per angle — never this prompt.
  const hasUnresolvedPartialFill = angles.some((a) => a.ranked && a.picked.length > 0 && a.picked.length < a.staffCount);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/projects", {
        client: f.client || "New client",
        account: f.account || undefined,
        topic: f.topic || "Untitled",
        projectLink: f.link,
        projectType: f.projectType,
        expertPool: f.expertPool,
        clientEntity: f.clientEntity,
        angles: angles.map((a, i) => {
          const perPerson = Math.ceil(a.goalTotal / (a.picked.length || 1));
          return {
            name: angleName(a, i),
            callsN: Number(a.callsN) || 0,
            goalTotal: a.goalTotal,
            // custom_goal is never sent — the server always derives it from goal.
            assignments: a.picked.map((r) => ({
              delivererId: r.personId,
              goal: perPerson,
              ...(r.personId in a.overrides ? { override: { justification: a.overrides[r.personId] } } : {}),
            })),
            // "Invisible competition" — only meaningful for Due Diligence/Strategy; omitted for Pitch (server default applies, harmlessly unread there).
            ...(f.projectType !== "Pitch" ? { invisibleCompetitionEnabled: a.invisibleCompetitionEnabled } : {}),
          };
        }),
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
              <label>Client Entity</label>
              <select
                value={f.clientEntity}
                onChange={(e) => setF({ ...f, clientEntity: Number(e.target.value) as FormState["clientEntity"] })}
              >
                {CLIENT_ENTITIES.map((n) => (
                  <option key={n} value={n}>
                    {entityName(n)}
                  </option>
                ))}
              </select>
            </div>

            {/* Big structural change — the simple (one-angle) case shows just
                the N input, no "angle" language at all. Only once a second
                angle is added does the angle structure (names, add/remove)
                become visible. */}
            {!multiAngle ? (
              <div className="field">
                <label>N — calls the client wants{f.projectType === "Pitch" ? " (0 if none agreed yet)" : ""}</label>
                <input
                  type="number"
                  min={minCallsN}
                  value={angles[0].callsN}
                  onChange={(e) => updateAngle(0, { callsN: e.target.value })}
                />
                <button
                  type="button"
                  className="link-btn"
                  style={{ display: "block", marginTop: 8 }}
                  onClick={addAngle}
                >
                  + Add angle
                </button>
              </div>
            ) : (
              <div className="field">
                <label>Angles — independent workstreams, each with its own N and goal</label>
                {angles.map((a, i) => (
                  <div
                    key={i}
                    style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
                  >
                    <input
                      value={a.name}
                      onChange={(e) => updateAngle(i, { name: e.target.value })}
                      placeholder={angleName(a, i)}
                      style={{ flex: 2 }}
                    />
                    <input
                      type="number"
                      min={minCallsN}
                      value={a.callsN}
                      onChange={(e) => updateAngle(i, { callsN: e.target.value })}
                      style={{ flex: 1, minWidth: 0 }}
                      placeholder="N"
                    />
                    <button type="button" className="btn-sm btn-ghost" onClick={() => removeAngle(i)}>
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" className="link-btn" onClick={addAngle}>
                  + Add angle
                </button>
              </div>
            )}

            <div className="field">
              <label>Project type</label>
              <div className="pick">
                {TYPES.map((t) => (
                  <button
                    key={t}
                    className={f.projectType === t ? "sel" : ""}
                    onClick={() => {
                      setF({ ...f, projectType: t });
                      // Non-Pitch types require N>=1 -- bump any angle still at 0.
                      if (t !== "Pitch") {
                        setAngles((prev) => prev.map((a) => (a.callsN === "0" ? { ...a, callsN: "2" } : a)));
                      }
                    }}
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
                disabled={!f.client || !allCallsNValid || !isValidHttpUrl(f.link)}
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
            {angles.map((a, i) => {
              const callsN = Number(a.callsN) || 0;
              return (
                <div key={i} style={{ marginBottom: multiAngle ? 18 : 0 }}>
                  {multiAngle && (
                    <div className="section-lbl" style={{ marginTop: i === 0 ? 0 : 4 }}>
                      {angleName(a, i)}
                    </div>
                  )}
                  <div className="suggest">
                    <div className="suggest-lbl">Goal — profiles to source</div>
                    <div className="suggest-big">{a.goalTotal}</div>
                    <div className="suggest-calc">{goalCalcText(f.projectType, callsN, a.goalTotal)}</div>
                    <div className="suggest-edit">
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Adjust goal</span>
                      <div className="step" style={{ marginLeft: "auto" }}>
                        <button onClick={() => updateAngle(i, { goalTotal: Math.max(1, a.goalTotal - 1) })}>−</button>
                        <span className="val">{a.goalTotal}</span>
                        <button onClick={() => updateAngle(i, { goalTotal: a.goalTotal + 1 })}>+</button>
                      </div>
                    </div>
                  </div>
                  {f.projectType === "Pitch" && callsN === 0 && (
                    <p style={{ fontSize: 11, color: "var(--soft)", margin: "-6px 0 12px" }}>
                      Load for this angle is pinned at a flat 1 while no calls are agreed — it won't consume capacity proportionally.
                    </p>
                  )}
                  <div className="suggest" style={{ background: "var(--dl-soft)", borderColor: "#B9E3DC" }}>
                    <div className="suggest-lbl" style={{ color: "var(--dl)" }}>
                      Delivering associates to staff
                    </div>
                    <div className="suggest-edit">
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {a.staffCount} {a.staffCount > 1 ? "people" : "person"} · ~{Math.ceil(a.goalTotal / a.staffCount)} each,
                        incl. {previewCustomGoal(Math.ceil(a.goalTotal / a.staffCount))} custom (auto)
                      </span>
                      <div className="step" style={{ marginLeft: "auto" }}>
                        <button onClick={() => updateAngle(i, { staffCount: Math.max(1, a.staffCount - 1) })}>−</button>
                        <span className="val">{a.staffCount}</span>
                        <button onClick={() => updateAngle(i, { staffCount: a.staffCount + 1 })}>+</button>
                      </div>
                    </div>
                  </div>
                  {/* "Invisible competition" — Due Diligence/Strategy only,
                      never Pitch. Defaults on; this is the one moment the PL
                      can switch it off before the system suggests a ghost. */}
                  {f.projectType !== "Pitch" && (
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "8px 2px 0", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={a.invisibleCompetitionEnabled}
                        onChange={(e) => updateAngle(i, { invisibleCompetitionEnabled: e.target.checked })}
                      />
                      Invisible competition — suggest a ghost deliverer for this angle if one's available
                    </label>
                  )}
                </div>
              );
            })}
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
            {/* Copy-only patch — was two separate blocks (soft-rule text +
                a large red "blocked by first-deliverable" box), both ending
                in the same "Pick instead" instruction. Combined into one
                quiet, informational line; blocked candidates are still
                overridable exactly as before (unchanged below). */}
            {!matching && <div className="match-hint">{matchHintText}</div>}
            {matching && (
              <div style={{ textAlign: "center", padding: 30, fontFamily: "'Space Grotesk'", color: "var(--soft)" }}>ranking…</div>
            )}

            {!matching &&
              angles.map((a, angleIndex) => (
                <div key={angleIndex} style={{ marginBottom: multiAngle ? 18 : 0 }}>
                  {multiAngle && (
                    <div className="section-lbl" style={{ marginTop: angleIndex === 0 ? 0 : 4 }}>
                      {angleName(a, angleIndex)}
                    </div>
                  )}
                  {a.ranked && a.picked.length === 0 && (
                    <div className="suggest" style={{ background: "var(--amber-bg)", borderColor: "#F0DCB0" }}>
                      <div className="suggest-lbl" style={{ color: "#9A5F0C" }}>
                        No one available now
                      </div>
                      <p style={{ fontSize: 13, margin: "6px 0 0", color: "var(--ink)" }}>
                        {totalEligible === 0
                          ? "Nobody's eligible anywhere right now — it'll broadcast to the wider team (everyone except Sick/Vacation, plus Offline after hours). First to accept a seat takes it."
                          : "It'll go to the open pool — eligible people can accept or decline."}
                      </p>
                    </div>
                  )}
                  {a.ranked && a.picked.length > 0 && a.picked.length < a.staffCount && (
                    <div className="suggest" style={{ background: "var(--amber-bg)", borderColor: "#F0DCB0" }}>
                      <div className="suggest-lbl" style={{ color: "#9A5F0C" }}>
                        Only {a.picked.length} of {a.staffCount} available for this angle
                      </div>
                      <p style={{ fontSize: 13, margin: "6px 0 8px", color: "var(--ink)" }}>
                        Not enough people available — reduce the number of required deliverers?
                      </p>
                      <button className="btn-sm btn-pl" onClick={() => updateAngle(angleIndex, { staffCount: a.picked.length })}>
                        Reduce to {a.picked.length} & continue
                      </button>
                    </div>
                  )}
                  {(a.ranked ?? [])
                    .filter((r) => r.eligible)
                    .slice(0, 8)
                    .map((r) => {
                      const isPicked = a.picked.some((p) => p.personId === r.personId);
                      const isOverridden = r.personId in a.overrides;
                      const placedElsewhere = !isPicked ? placedOnOtherAngle(r.personId, angleIndex) : null;
                      return (
                        <div key={r.personId} className={"match-line " + (isPicked ? "picked " : "")}>
                          <div className="avatar">{initials(nameOf(r.personId))}</div>
                          <div>
                            <div className="assignee-name">
                              {nameOf(r.personId)} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {practiceOf(r.personId)}</span>
                            </div>
                            <div className="assignee-sub">
                              {isPicked
                                ? <span className="picktag">Picked ✓{isOverridden ? " · override" : r.practiceAreaMatch ? " · your practice" : ""}</span>
                                : placedElsewhere
                                ? `Picked on ${placedElsewhere}`
                                : r.free
                                ? "Free"
                                : "Available"}
                            </div>
                          </div>
                          <div className="load-score">
                            <b>{r.load.toFixed(1)}</b>
                            <small>Load</small>
                          </div>
                          {!isPicked && a.picked.length > 0 && (
                            <button className="btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={() => startOverride(angleIndex, r.personId)}>
                              Pick instead
                            </button>
                          )}
                        </div>
                      );
                    })}

                  {/* Blocked people used to rank below the eligible and fall off
                      the top-8 slice — invisible. They're their own section now,
                      like managers: never auto-picked, always manually pickable
                      as an override (reason optional, logged). */}
                  {(a.ranked ?? []).some((r) => !r.eligible) && (
                    <div className="section-lbl" style={{ marginTop: 10 }}>
                      Blocked right now — always a manual pick
                    </div>
                  )}
                  {(a.ranked ?? [])
                    .filter((r) => !r.eligible)
                    .map((r) => (
                      <div key={r.personId} className="match-line blocked">
                        <div className="avatar">{initials(nameOf(r.personId))}</div>
                        <div>
                          <div className="assignee-name">
                            {nameOf(r.personId)} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {practiceOf(r.personId)}</span>
                          </div>
                          <div className="assignee-sub">
                            {r.ineligibleReason === "not_on_sunday_rota"
                              ? "Not on today's Sunday rota"
                              : r.ineligibleReason === "first_deliverable_conflict"
                              ? "Busy — first deliverable elsewhere"
                              : "Evening coverage off"}
                          </div>
                        </div>
                        <div className="load-score">
                          <b>{r.load.toFixed(1)}</b>
                          <small>Load</small>
                        </div>
                        <button className="btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={() => startOverride(angleIndex, r.personId)}>
                          Pick instead
                        </button>
                      </div>
                    ))}

                  {/* Managers never appear in `a.ranked` (excluded at the
                      source — never suggested, never auto-picked), so
                      they're a separate, always-visible add-a-manager
                      section instead of a row in the ranked list above. */}
                  {people
                    .filter((p) => (p.isManager || p.isOwner) && p.status === "Available" && !a.picked.some((pk) => pk.personId === p.id))
                    .map((m) => (
                      <div key={m.id} className="match-line">
                        <div className="avatar">{initials(m.name)}</div>
                        <div>
                          <div className="assignee-name">
                            {m.name} <span style={{ color: "var(--soft)", fontWeight: 500 }}>· {m.practiceArea}</span>
                          </div>
                          <div className="assignee-sub">Manager — never suggested, always a manual pick</div>
                        </div>
                        <button className="btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={() => startOverride(angleIndex, m.id)}>
                          Pick instead
                        </button>
                      </div>
                    ))}

                  {overridingAngle === angleIndex && overridingId && (
                    <div className="suggest" style={{ marginTop: 10 }}>
                      <div className="suggest-lbl">Override — pick {nameOf(overridingId)} instead of…</div>
                      {a.picked.length > 1 ? (
                        <select
                          value={replaceTarget}
                          onChange={(e) => setReplaceTarget(e.target.value)}
                          style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)", margin: "8px 0", fontSize: 13, color: "var(--ink)" }}
                        >
                          {a.picked.map((p) => (
                            <option key={p.personId} value={p.personId}>
                              {nameOf(p.personId)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p style={{ fontSize: 12, margin: "8px 0", color: "var(--ink)" }}>{nameOf(replaceTarget)}</p>
                      )}
                      <div className="field">
                        <label>Justification — optional, saved to the audit trail if you add one</label>
                        <input
                          ref={justificationRef}
                          value={justificationText}
                          onChange={(e) => setJustificationText(e.target.value)}
                          placeholder="e.g. client specifically asked for this person"
                        />
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-ghost" onClick={() => setOverridingAngle(null)}>
                          Cancel
                        </button>
                        <button className="btn btn-pl" onClick={confirmOverride}>
                          Confirm override
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

            {!matching && (
              <div className="sheet-footer">
                {/* CHANGE 4 — do not silently reduce and do not proceed while
                    an angle is only partially filled; the PL must explicitly
                    confirm the reduced number (the "Reduce to N & continue"
                    button above) before Assign & notify becomes available. */}
                <button
                  className="btn btn-pl"
                  style={{ width: "100%" }}
                  disabled={busy || hasUnresolvedPartialFill}
                  onClick={confirm}
                  title={hasUnresolvedPartialFill ? "Resolve the partial-fill angle(s) above first" : undefined}
                >
                  {totalPicked ? `Assign ${totalPicked} & notify` : "Post to open pool"}
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
