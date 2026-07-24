import { useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Person, Project } from "../api/types";
import Sheet from "../components/Sheet";
import { initials } from "../lib/format";
import { useApp } from "../state/AppContext";

/**
 * "Transfer to a different PL" — hand a project card to any PL across the
 * whole BU (a PL going on vacation/sick, or a manager rebalancing). Pick one
 * person, confirm, and the server moves the card: it leaves this board and
 * lands on the new PL's. The picker is BU-wide (everyone is a potential PL —
 * role is per-project), excluding the current PL, deactivated accounts, and
 * ghosts. The route (POST /projects/:id/transfer) enforces the PL-or-manager
 * permission server-side; this sheet is only ever opened from a card the
 * actor can already edit.
 */
export default function TransferPlSheet({
  project,
  onClose,
  onTransferred,
}: {
  project: Project;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const { people, nameOf, teamNameOf } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // BU-wide candidate list: everyone except the current PL, deactivated
  // people, and ghosts (a ghost is invisible competition, never a real PL).
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => p.id !== project.plId && !p.deactivatedAt && !p.isGhost)
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [people, project.plId, query]);

  const confirm = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/projects/${project.id}/transfer`, { newPlId: selectedId });
      onTransferred();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not transfer the project");
      setBusy(false);
    }
  };

  const roleTag = (p: Person) => (p.isOwner ? "Owner" : p.isManager ? "Manager" : "Associate");

  return (
    <Sheet onClose={onClose}>
      <h2>Transfer to another PL</h2>
      <div className="sub">
        {project.client}
        {project.topic ? ` — ${project.topic}` : ""}. Currently led by {nameOf(project.plId)}. Pick who should lead it now —
        the card moves to their board.
      </div>
      {error && <div className="err-line">{error}</div>}

      <input
        className="transfer-search"
        placeholder="Search everyone in the BU…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="transfer-list">
        {candidates.length === 0 && <div className="empty">No matching people.</div>}
        {candidates.map((p) => (
          <button
            key={p.id}
            className={"match-line" + (selectedId === p.id ? " picked" : "")}
            onClick={() => setSelectedId(p.id)}
            style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
          >
            <div className="avatar">{initials(p.name)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="assignee-name">{p.name}</div>
              <div className="assignee-sub">
                {roleTag(p)}
                {p.teamId ? ` · ${teamNameOf(p.teamId).replace("Team_", "")}` : ""}
                {p.practiceArea ? ` · ${p.practiceArea}` : ""}
              </div>
            </div>
            {selectedId === p.id && <span className="picktag" style={{ marginLeft: "auto" }}>✓ Selected</span>}
          </button>
        ))}
      </div>

      <div className="sheet-footer">
        <button
          className="btn btn-pl"
          style={{ width: "100%" }}
          disabled={!selectedId || busy}
          title={!selectedId ? "Pick a person first" : undefined}
          onClick={confirm}
        >
          {busy ? "Transferring…" : selectedId ? `Transfer to ${nameOf(selectedId)}` : "Transfer"}
        </button>
        <button className="close" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
