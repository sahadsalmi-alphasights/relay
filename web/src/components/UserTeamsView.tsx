import { useState, type CSSProperties } from "react";
import type { AdminUser, Team } from "../api/types";

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "4px 6px",
  border: "1px solid var(--line)",
  borderRadius: 6,
  font: "inherit",
  fontSize: 12,
  background: "var(--surface)",
  color: "var(--ink)",
};

/**
 * User Management → Teams: rename in place, assign the team's manager
 * (picking one demotes any other manager on that team — owner flags are
 * never touched), create new teams, and delete empty ones. Server-enforced
 * owner-only; every action is audit-logged.
 */
export default function UserTeamsView({
  teams,
  users,
  busyId,
  onRename,
  onAssignManager,
  onDelete,
  onCreate,
}: {
  teams: Team[];
  users: AdminUser[];
  busyId: string | null;
  onRename: (team: Team, name: string) => void;
  onAssignManager: (team: Team, personId: string | null) => void;
  onDelete: (team: Team, memberCount: number) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreate(newName.trim());
      setNewName("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="audit-filters">
        <input
          style={{ flex: 1, minWidth: 200 }}
          placeholder="New team name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button className="btn-sm btn-pl" disabled={creating || !newName.trim()} onClick={create}>
          ＋ Create team
        </button>
      </div>
      <table className="data-table" style={{ maxWidth: 760 }}>
        <thead>
          <tr>
            <th>Team</th>
            <th>Manager</th>
            <th style={{ textAlign: "center" }}>Members</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => {
            const members = users.filter((u) => u.teamId === t.id);
            const active = members.filter((m) => !m.deactivatedAt);
            const managerId = active.find((m) => m.isManager)?.id ?? "";
            return (
              <tr key={t.id}>
                <td style={{ minWidth: 160 }}>
                  <input
                    style={inputStyle}
                    defaultValue={t.name}
                    disabled={busyId === t.id}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.name && onRename(t, e.target.value.trim())}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                </td>
                <td>
                  <select
                    className="stage-select"
                    value={managerId}
                    disabled={busyId === t.id}
                    title="Assigning a manager demotes any other manager on this team"
                    onChange={(e) => onAssignManager(t, e.target.value || null)}
                  >
                    <option value="">— No manager —</option>
                    {active.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: "center" }}>{members.length}</td>
                <td>
                  <button
                    className="btn-sm btn-ghost btn-del-user"
                    disabled={busyId === t.id}
                    title={members.length > 0 ? "Only empty teams can be deleted — move the members first" : "Delete this team"}
                    onClick={() => onDelete(t, members.length)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {teams.length === 0 && <div className="empty">No teams yet — create the first one above.</div>}
      <div className="group-foot">
        Members are moved between teams on the Users tab (team dropdown) or by the team's manager via My Team. A team
        must be empty before it can be deleted. Managers assigned here get manager permissions per the User groups
        matrix, scoped to this team.
      </div>
    </>
  );
}
