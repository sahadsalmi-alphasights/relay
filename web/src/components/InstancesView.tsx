import { useState, type CSSProperties } from "react";
import type { AdminUser, Instance } from "../api/types";

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 200,
  padding: "4px 6px",
  border: "1px solid var(--line)",
  borderRadius: 6,
  font: "inherit",
  fontSize: 12,
  background: "var(--surface)",
  color: "var(--ink)",
};

/**
 * User management → Instances: the isolated-BU registry. Owners see every
 * instance, how many people are assigned to each, and can create new ones.
 * Assigning a person to an instance happens on the Users tab (BU dropdown);
 * server-enforced owner-only, audit-logged.
 */
export default function InstancesView({
  instances,
  users,
  onCreate,
}: {
  instances: Instance[];
  users: AdminUser[];
  onCreate: (name: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const memberCount = (key: string) => users.filter((u) => (u.instanceKeys ?? []).includes(key)).length;

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
          style={inputStyle}
          placeholder="New instance name (e.g. Consulting)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button className="btn-sm btn-pl" disabled={creating || !newName.trim()} onClick={create}>
          ＋ Create instance
        </button>
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Key</th>
            <th>Members</th>
          </tr>
        </thead>
        <tbody>
          {instances.map((i) => (
            <tr key={i.id}>
              <td style={{ fontWeight: 600 }}>{i.name}</td>
              <td style={{ fontSize: 11, color: "var(--soft)", fontFamily: "var(--mono, monospace)" }}>{i.key}</td>
              <td>{memberCount(i.key)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontSize: 11, color: "var(--soft)", marginTop: 8 }}>
        Each instance is a fully isolated environment — users only ever see their own instance's data. Assign a person to
        an instance from the Users tab (BU dropdown). Okta's department will map users automatically once configured.
      </p>
    </>
  );
}
