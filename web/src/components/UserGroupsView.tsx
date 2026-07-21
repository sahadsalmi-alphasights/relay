import { Fragment, type CSSProperties } from "react";
import type { AdminUser, PermissionMatrix, PermissionRole, Role } from "../api/types";
import { initials } from "../lib/format";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

interface GroupDef {
  role: Role;
  accent: string;
  blurb: string;
}

const GROUPS: GroupDef[] = [
  {
    role: "owner",
    accent: "#FC8300",
    blurb: "Every permission in the app, always — locked on. Protected by the allowlist; can never be demoted or locked out.",
  },
  {
    role: "manager",
    accent: "#1F4E85",
    blurb: "Runs the boards. Exactly what this group can do is set in the permission matrix below.",
  },
  {
    role: "member",
    accent: "#0E8C7F",
    blurb: "Everyone else — full control of their own work. Extra powers can be granted in the matrix below.",
  },
];

/** Rows of the adjustable matrix — keys must match server/src/rules/permissionMatrix.ts. */
const PERM_ROWS: { group: string; key: string; label: string; hint?: string }[] = [
  { group: "Projects — anyone's, not just their own", key: "projects.edit_any", label: "Edit any project", hint: "set-up, team, goals, stages, calls sold, notes" },
  { group: "Projects — anyone's, not just their own", key: "projects.archive_delete", label: "Archive & delete any project" },
  { group: "Projects — anyone's, not just their own", key: "projects.resolve_goal_requests", label: "Resolve goal-change requests", hint: "accept or decline on any project" },
  { group: "People — exercised within their own team", key: "people.set_status", label: "Set members' status", hint: "Available / Vacation / Sick / Offline" },
  { group: "People — exercised within their own team", key: "people.manage_roster", label: "Add & remove team members" },
  { group: "People — exercised within their own team", key: "people.set_ghost", label: "Flag ghost deliverers" },
  { group: "Operations", key: "rota.manage", label: "Edit Sunday rota & resolve swaps" },
  { group: "Operations", key: "audit.view", label: "View the audit log" },
];

export default function UserGroupsView({
  users,
  busyId,
  onChangeRole,
  matrix,
  onTogglePermission,
}: {
  users: AdminUser[];
  busyId: string | null;
  onChangeRole: (u: AdminUser, role: Role) => void;
  matrix: PermissionMatrix | null;
  onTogglePermission: (role: PermissionRole, key: string, allowed: boolean) => void;
}) {
  let lastGroup = "";
  return (
    <>
      <div className="group-grid">
        {GROUPS.map((g) => {
          const members = users.filter((u) => u.role === g.role);
          return (
            <div key={g.role} className="group-card" style={{ "--gc": g.accent } as CSSProperties}>
              <div className="group-title">
                {cap(g.role)}s <span className="group-count">{members.length}</span>
              </div>
              <div className="group-blurb">{g.blurb}</div>
              <div className="group-members">
                {members.length === 0 && <div className="gm-mail">Nobody in this group yet.</div>}
                {members.map((u) => (
                  <div key={u.id} className="group-member" style={u.deactivatedAt ? { opacity: 0.55 } : undefined}>
                    <div className="avatar">{initials(u.name)}</div>
                    <div className="gm-info">
                      <div className="gm-name">
                        {u.name}
                        {u.deactivatedAt && <span className="gm-tag">deactivated</span>}
                      </div>
                      <div className="gm-mail">{u.email}</div>
                    </div>
                    <select
                      className="stage-select"
                      title="Move to another group"
                      value={u.role}
                      disabled={busyId === u.id}
                      onChange={(e) => {
                        const r = e.target.value as Role;
                        if (r !== u.role) onChangeRole(u, r);
                      }}
                    >
                      {GROUPS.map((o) => (
                        <option key={o.role} value={o.role}>
                          {cap(o.role)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="section-lbl spaced">Permission matrix</div>
      <div className="scope-note">
        Tick a box to grant that permission to the whole group — enforced by the server immediately, audit-logged.
        The PL always keeps full control of their own projects regardless of these settings.
      </div>
      {!matrix ? (
        <div className="empty">Loading permissions…</div>
      ) : (
        <table className="data-table perm-table">
          <thead>
            <tr>
              <th>Permission</th>
              <th style={{ textAlign: "center" }}>Member</th>
              <th style={{ textAlign: "center" }}>Manager</th>
              <th style={{ textAlign: "center" }}>Owner</th>
            </tr>
          </thead>
          <tbody>
            {PERM_ROWS.map((row) => {
              const groupHeader =
                row.group !== lastGroup ? (
                  <tr key={row.group} className="perm-group">
                    <td colSpan={4}>{row.group}</td>
                  </tr>
                ) : null;
              lastGroup = row.group;
              return (
                <Fragment key={row.key}>
                  {groupHeader}
                  <tr>
                    <td>
                      <div className="perm-label">{row.label}</div>
                      {row.hint && <div className="perm-hint">{row.hint}</div>}
                    </td>
                    {(["member", "manager"] as PermissionRole[]).map((role) => (
                      <td key={role} style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          className="perm-check"
                          checked={matrix[role]?.[row.key] === true}
                          onChange={(e) => onTogglePermission(role, row.key, e.target.checked)}
                          aria-label={`${row.label} — ${role}s`}
                        />
                      </td>
                    ))}
                    <td style={{ textAlign: "center" }}>
                      <span className="perm-lock" title="Owners always have every permission">
                        ✓
                      </span>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            <tr className="perm-group">
              <td colSpan={4}>Administration</td>
            </tr>
            <tr>
              <td>
                <div className="perm-label">User Management portal</div>
                <div className="perm-hint">owner-only by design — not adjustable, so access can never be locked out</div>
              </td>
              <td style={{ textAlign: "center" }}>
                <span className="perm-never" title="Owner-only by design">
                  —
                </span>
              </td>
              <td style={{ textAlign: "center" }}>
                <span className="perm-never" title="Owner-only by design">
                  —
                </span>
              </td>
              <td style={{ textAlign: "center" }}>
                <span className="perm-lock" title="Owners always have every permission">
                  ✓
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <div className="group-foot">
        Owners aren't part of the matrix — they hold every permission unconditionally. People-permissions apply within
        the person's own team (owners act everywhere). One app-wide exception: evening coverage stays self-serve for
        everyone; nobody sets it on someone else's behalf.
      </div>
    </>
  );
}
