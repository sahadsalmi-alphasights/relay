import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AdminUser, Role, Team } from "../api/types";
import { useViewport } from "../lib/useViewport";
import { useApp } from "../state/AppContext";

const ROLES: Role[] = ["owner", "manager", "member"];

function lastLogin(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Owner-only user management portal. Gated in the sidebar and enforced again
 * server-side by /users (app.requireOwner) — the buttons here are just the UI.
 */
export default function UserManagementTab({ reloadTick }: { reloadTick: number }) {
  const { actor } = useApp();
  const { isDesktop } = useViewport();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [u, t] = await Promise.all([api.get<AdminUser[]>("/users"), api.get<Team[]>("/teams")]);
      setUsers(u);
      setTeams(t);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load users");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That change could not be saved");
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = (u: AdminUser, role: Role) =>
    run(u.id, () => api.patch(`/users/${u.id}/role`, { role }));
  const changeTeam = (u: AdminUser, teamId: string) =>
    run(u.id, () => api.patch(`/users/${u.id}`, { teamId: teamId || null }));
  const toggleActive = (u: AdminUser) =>
    run(u.id, () => api.post(`/users/${u.id}/${u.deactivatedAt ? "reactivate" : "deactivate"}`));

  if (error && !users) {
    return (
      <>
        <div className="section-lbl">User management</div>
        <div className="empty">{error}</div>
      </>
    );
  }
  if (!users) return <div className="empty">Loading…</div>;

  const roleSelect = (u: AdminUser) => (
    <select
      className="stage-select"
      value={u.role}
      disabled={busyId === u.id}
      onChange={(e) => changeRole(u, e.target.value as Role)}
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {r[0].toUpperCase() + r.slice(1)}
        </option>
      ))}
    </select>
  );

  const teamSelect = (u: AdminUser) => (
    <select
      className="stage-select"
      value={u.teamId ?? ""}
      disabled={busyId === u.id}
      onChange={(e) => changeTeam(u, e.target.value)}
    >
      <option value="">— No team —</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );

  const accessBtn = (u: AdminUser) => {
    const isSelf = u.id === actor.id;
    return (
      <button
        className={"btn-sm " + (u.deactivatedAt ? "btn-dl" : "btn-ghost")}
        disabled={busyId === u.id || isSelf}
        title={isSelf ? "You cannot deactivate yourself" : ""}
        onClick={() => toggleActive(u)}
      >
        {u.deactivatedAt ? "Reactivate" : "Deactivate"}
      </button>
    );
  };

  const header = (
    <div className="section-lbl">
      User management <span className="count">{users.length}</span>
    </div>
  );

  if (isDesktop) {
    return (
      <>
        {header}
        {error && <div className="err-line">{error}</div>}
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Team</th>
              <th>Status</th>
              <th>Last login</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={u.deactivatedAt ? { opacity: 0.55 } : undefined}>
                <td>
                  <div style={{ fontWeight: 600 }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: "var(--soft)" }}>{u.email}</div>
                </td>
                <td>{roleSelect(u)}</td>
                <td>{teamSelect(u)}</td>
                <td>{u.status}</td>
                <td>{lastLogin(u.lastLoginAt)}</td>
                <td>{accessBtn(u)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <>
      {header}
      {error && <div className="err-line">{error}</div>}
      {users.map((u) => (
        <div key={u.id} className="member" style={u.deactivatedAt ? { opacity: 0.55 } : undefined}>
          <div className="member-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="assignee-name">{u.name}</div>
              <div className="assignee-sub">{u.email}</div>
            </div>
            {accessBtn(u)}
          </div>
          <div className="cov-row">
            <span className="cov-lbl">Role</span>
            {roleSelect(u)}
          </div>
          <div className="cov-row">
            <span className="cov-lbl">Team</span>
            {teamSelect(u)}
          </div>
          <div className="cov-row">
            <span className="cov-lbl">
              Status <small>· last login {lastLogin(u.lastLoginAt)}</small>
            </span>
            <span>{u.status}</span>
          </div>
        </div>
      ))}
    </>
  );
}
