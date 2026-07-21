import type { CSSProperties } from "react";
import type { AdminUser, Role } from "../api/types";
import { initials } from "../lib/format";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

interface GroupDef {
  role: Role;
  accent: string;
  blurb: string;
  perms: string[];
}

/**
 * The three permission groups. These lists mirror the server-side predicates
 * in server/src/rules/permissions.ts — the server enforces every one of them
 * on every request; this page is the human-readable single source of truth.
 */
const GROUPS: GroupDef[] = [
  {
    role: "owner",
    accent: "#FC8300",
    blurb: "Every permission in the app — nothing is off-limits.",
    perms: [
      "Everything Managers and Members can do, on every team and every project",
      "User Management: add users, move people between groups, edit profiles, deactivate & reactivate",
      "Protected by the owner allowlist — can never be demoted or locked out",
    ],
  },
  {
    role: "manager",
    accent: "#1F4E85",
    blurb: "Runs the boards — full control of projects and of their team's people.",
    perms: [
      "Full control of every project: edit set-up & team, per-deliverer goals, stages, calls sold, notes, archive, delete",
      "Resolve goal-change requests on any project",
      "Team roster: add & remove members, set status (Available / Vacation / Sick / Offline)",
      "Flag or unflag ghost deliverers on their own team",
      "Edit the Sunday rota and resolve swap requests",
      "View the Audit Log",
    ],
  },
  {
    role: "member",
    accent: "#0E8C7F",
    blurb: "Everyone else — full control of their own work, none of anyone else's.",
    perms: [
      "Create projects and lead them — full PL control of their own projects",
      "Log deliveries & progress on their own assignments",
      "Request goal changes and claim open-pool broadcast seats",
      "Toggle their own evening coverage; manage their own notifications",
    ],
  },
];

/**
 * User Management → "User groups": one card per group showing its fixed
 * permission set and its members. Moving someone between groups is the same
 * owner-only, audit-logged role change as the Users list — just organised
 * from the group's side.
 */
export default function UserGroupsView({
  users,
  busyId,
  onChangeRole,
}: {
  users: AdminUser[];
  busyId: string | null;
  onChangeRole: (u: AdminUser, role: Role) => void;
}) {
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
              <ul className="perm-list">
                {g.perms.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
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
      <div className="group-foot">
        Every permission here is enforced by the server on every request — moving someone between groups takes effect
        immediately and is audit-logged. One deliberate exception app-wide: evening coverage is self-serve for
        everyone; nobody sets it on someone else's behalf.
      </div>
    </>
  );
}
