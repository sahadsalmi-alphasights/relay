import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { EXPERT_POOLS } from "../api/types";
import type { Angle, Project } from "../api/types";
import Sheet from "../components/Sheet";
import { CLIENT_ENTITY_IDS, entityName } from "../lib/format";

const TYPES = ["Pitch", "Due Diligence", "Strategy"] as const;
const CLIENT_ENTITIES = CLIENT_ENTITY_IDS;

function isValidHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Project set-up details, PL-only, audit-logged server-side: client, topic,
 * project link, type, and the project's angles (rename, add, edit an
 * angle's N, remove). Big structural change — editing an angle's N
 * re-suggests its goal and, if the angle already has staffed assignments,
 * cascades that new goal through the existing rounds mechanism server-side
 * (same as a stage-driven goal change): a new round starts for each of that
 * angle's assignees.
 */
export default function EditProjectSheet({
  projectId,
  onClose,
  onChanged,
}: {
  projectId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [angles, setAngles] = useState<Angle[] | null>(null);
  const [assignmentCounts, setAssignmentCounts] = useState<Record<string, number>>({});
  const [client, setClient] = useState("");
  const [topic, setTopic] = useState("");
  const [link, setLink] = useState("");
  const [projectType, setProjectType] = useState<(typeof TYPES)[number]>("Pitch");
  const [clientEntity, setClientEntity] = useState<(typeof CLIENT_ENTITIES)[number]>(1);
  const [savingFields, setSavingFields] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newAngleOpen, setNewAngleOpen] = useState(false);
  const [newAngleName, setNewAngleName] = useState("");
  const [newAngleN, setNewAngleN] = useState(1);

  const reload = async () => {
    const detail = await api.get<{ project: Project; assignments: { angleId: string }[]; angles: Angle[] }>(
      `/projects/${projectId}`
    );
    setProject(detail.project);
    setAngles(detail.angles);
    setClient(detail.project.client);
    setTopic(detail.project.topic ?? "");
    setLink(detail.project.projectLink);
    setProjectType(detail.project.projectType);
    setClientEntity(detail.project.clientEntity as (typeof CLIENT_ENTITIES)[number]);
    const counts: Record<string, number> = {};
    for (const a of detail.assignments) counts[a.angleId] = (counts[a.angleId] ?? 0) + 1;
    setAssignmentCounts(counts);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (!project || !angles) {
    return (
      <Sheet onClose={onClose} desktopVariant="dialog">
        <div className="empty">Loading…</div>
      </Sheet>
    );
  }

  const minCallsN = projectType === "Pitch" ? 0 : 1;
  const fieldsChanged =
    client !== project.client ||
    topic !== (project.topic ?? "") ||
    link !== project.projectLink ||
    projectType !== project.projectType;

  const saveFields = async () => {
    setSavingFields(true);
    setError(null);
    try {
      await api.patch(`/projects/${projectId}`, { client, topic, projectLink: link, projectType });
      onChanged();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save project details");
    } finally {
      setSavingFields(false);
    }
  };

  /**
   * Client Entity is a single, low-consequence pick (which board row a card
   * groups under) -- same category as an angle's name or N, both of which
   * already auto-save immediately elsewhere in this sheet. Batching it
   * behind "Save project details" alongside client/topic/link/type (each of
   * which genuinely warrants a deliberate, validated save) made it easy to
   * pick a new entity, close the sheet, and never actually persist the
   * change -- the card silently never moved rows.
   */
  const patchEntity = async (next: (typeof CLIENT_ENTITIES)[number]) => {
    setClientEntity(next);
    setError(null);
    try {
      await api.patch(`/projects/${projectId}`, { clientEntity: next });
      onChanged();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update Client Entity");
    }
  };

  const patchAngle = async (angleId: string, patch: Record<string, unknown>) => {
    setError(null);
    try {
      await api.patch(`/angles/${angleId}`, patch);
      onChanged();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the angle");
    }
  };

  const removeAngle = async (angleId: string) => {
    setError(null);
    try {
      await api.del(`/angles/${angleId}`);
      onChanged();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the angle");
    }
  };

  const addAngle = async () => {
    if (!newAngleName.trim()) return;
    setError(null);
    try {
      await api.post(`/projects/${projectId}/angles`, { name: newAngleName.trim(), callsN: newAngleN });
      setNewAngleOpen(false);
      setNewAngleName("");
      setNewAngleN(1);
      onChanged();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the angle");
    }
  };

  return (
    <Sheet onClose={onClose} desktopVariant="dialog">
      <h2>Edit project</h2>
      <div className="sub">{project.client} — set-up details, PL-only.</div>
      {error && <div className="err-line">{error}</div>}

      <div className="field">
        <label>Client</label>
        <input value={client} onChange={(e) => setClient(e.target.value)} />
      </div>
      <div className="field">
        <label>Topic / account</label>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} />
      </div>
      <div className="field">
        <label>Project link</label>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
        {link.length > 0 && !isValidHttpUrl(link) && (
          <p style={{ fontSize: 11, color: "#A82F2F", margin: "6px 0 0" }}>Must be a valid http(s) link.</p>
        )}
      </div>
      <div className="field">
        <label>Project type</label>
        <div className="pick">
          {TYPES.map((t) => (
            <button key={t} className={projectType === t ? "sel" : ""} onClick={() => setProjectType(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Client Entity</label>
        <select
          value={clientEntity}
          onChange={(e) => patchEntity(Number(e.target.value) as (typeof CLIENT_ENTITIES)[number])}
        >
          {CLIENT_ENTITIES.map((n) => (
            <option key={n} value={n}>
              {entityName(n)}
            </option>
          ))}
        </select>
      </div>
      <button
        className="btn btn-pl"
        style={{ width: "100%", marginBottom: 18 }}
        disabled={!fieldsChanged || savingFields || !client || !isValidHttpUrl(link)}
        onClick={saveFields}
      >
        Save project details
      </button>

      <div className="section-lbl">
        Angles <span className="count">{angles.length}</span>
      </div>
      <p style={{ fontSize: 11, color: "var(--soft)", margin: "-6px 0 12px" }}>
        Independent workstreams, each with its own N and goal. Editing N re-suggests the goal — if this angle already
        has staffed deliverers, their goal follows automatically and starts a new round.
      </p>
      {angles.map((ang) => {
        const staffed = assignmentCounts[ang.id] ?? 0;
        return (
          <div key={ang.id} className="member">
            <div className="field" style={{ marginBottom: 8 }}>
              <input
                defaultValue={ang.name}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value.trim() !== ang.name) {
                    patchAngle(ang.id, { name: e.target.value.trim() });
                  }
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>N</span>
              <div className="step">
                <button
                  disabled={ang.callsN <= minCallsN}
                  onClick={() => patchAngle(ang.id, { callsN: Math.max(minCallsN, ang.callsN - 1) })}
                >
                  −
                </button>
                <span className="val">{ang.callsN}</span>
                <button onClick={() => patchAngle(ang.id, { callsN: ang.callsN + 1 })}>+</button>
              </div>
              <span style={{ fontSize: 12, color: "var(--soft)" }}>
                goal {ang.goalTotal} · {staffed} staffed
              </span>
              {/* Per-angle expert pool (2026-07-21) — auto-saves like N; the
                  pool feeds load weighting, so the ranking refreshes live.
                  "Project default" (null) inherits the project's pool, live. */}
              <select
                className="stage-select"
                value={ang.expertPool ?? ""}
                title="Expert pool for this angle"
                onChange={(e) => patchAngle(ang.id, { expertPool: e.target.value || null })}
              >
                <option value="">Project default</option>
                {EXPERT_POOLS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button
                className="btn-sm btn-ghost"
                style={{ marginLeft: "auto", color: "#A82F2F" }}
                disabled={staffed > 0 || angles.length <= 1}
                title={staffed > 0 ? "Remove this angle's assignments first" : angles.length <= 1 ? "A project needs at least one angle" : "Remove this angle"}
                onClick={() => removeAngle(ang.id)}
              >
                Remove
              </button>
            </div>
          </div>
        );
      })}

      {!newAngleOpen ? (
        <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => setNewAngleOpen(true)}>
          + Add angle
        </button>
      ) : (
        <div className="member">
          <div className="field" style={{ marginBottom: 8 }}>
            <input
              value={newAngleName}
              onChange={(e) => setNewAngleName(e.target.value)}
              placeholder="Angle name"
              autoFocus
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>N</span>
            <div className="step">
              <button disabled={newAngleN <= minCallsN} onClick={() => setNewAngleN((n) => Math.max(minCallsN, n - 1))}>
                −
              </button>
              <span className="val">{newAngleN}</span>
              <button onClick={() => setNewAngleN((n) => n + 1)}>+</button>
            </div>
            <button className="btn-sm btn-pl" style={{ marginLeft: "auto" }} disabled={!newAngleName.trim()} onClick={addAngle}>
              Add
            </button>
            <button className="btn-sm btn-ghost" onClick={() => setNewAngleOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="sheet-footer">
        <button className="close" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
