import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, ApiError } from "../api/client";
import type { AdminUser, PermissionMatrix, PermissionRole, PersonStatus, Role, Team } from "../api/types";
import UserGroupsView from "../components/UserGroupsView";
import { useViewport } from "../lib/useViewport";
import { useApp } from "../state/AppContext";

const ROLES: Role[] = ["owner", "manager", "member"];
const STATUSES: PersonStatus[] = ["Available", "On vacation", "Sick", "Offline"];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function lastLogin(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

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
 * Owner-only user management portal. Gated in the sidebar and enforced again
 * server-side by /users (app.requireOwner). Full manual management: search,
 * pre-provision, role/team/status, profile edits, deactivate/reactivate.
 */
export default function UserManagementTab({ reloadTick }: { reloadTick: number }) {
  const { actor } = useApp();
  const { isDesktop } = useViewport();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [view, setView] = useState<"users" | "groups">("users");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ email: string; name: string; role: Role; teamId: string }>({
    email: "",
    name: "",
    role: "member",
    teamId: "",
  });

  const load = async () => {
    setError(null);
    try {
      const [u, t, p] = await Promise.all([
        api.get<AdminUser[]>("/users"),
        api.get<Team[]>("/teams"),
        api.get<{ matrix: PermissionMatrix }>("/users/permissions"),
      ]);
      setUsers(u);
      setTeams(t);
      setMatrix(p.matrix);
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

  const changeRole = (u: AdminUser, role: Role) => run(u.id, () => api.patch(`/users/${u.id}/role`, { role }));
  // Matrix toggle: optimistic flip, server truth on response, reload on failure.
  const togglePermission = async (role: PermissionRole, key: string, allowed: boolean) => {
    setError(null);
    setMatrix((prev) => (prev ? { ...prev, [role]: { ...prev[role], [key]: allowed } } : prev));
    try {
      const res = await api.patch<{ matrix: PermissionMatrix }>("/users/permissions", { role, key, allowed });
      setMatrix(res.matrix);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That permission change could not be saved");
      await load();
    }
  };
  const patchField = (u: AdminUser, patch: Record<string, unknown>) =>
    run(u.id, () => api.patch(`/users/${u.id}`, patch));
  const toggleActive = (u: AdminUser) =>
    run(u.id, () => api.post(`/users/${u.id}/${u.deactivatedAt ? "reactivate" : "deactivate"}`));

  const addUser = async () => {
    if (!form.email.trim() || !form.name.trim()) {
      setError("Email and name are required");
      return;
    }
    setBusyId("new");
    setError(null);
    try {
      await api.post("/users", {
        email: form.email.trim(),
        name: form.name.trim(),
        role: form.role,
        teamId: form.teamId || null,
      });
      setForm({ email: "", name: "", role: "member", teamId: "" });
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the user");
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.includes(q)
    );
  }, [users, search]);

  const counts = useMemo(() => {
    const c = { owner: 0, manager: 0, member: 0, deactivated: 0 };
    (users ?? []).forEach((u) => {
      c[u.role] += 1;
      if (u.deactivatedAt) c.deactivated += 1;
    });
    return c;
  }, [users]);

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
    <select className="stage-select" value={u.role} disabled={busyId === u.id} onChange={(e) => changeRole(u, e.target.value as Role)}>
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {cap(r)}
        </option>
      ))}
    </select>
  );
  const teamSelect = (u: AdminUser) => (
    <select className="stage-select" value={u.teamId ?? ""} disabled={busyId === u.id} onChange={(e) => patchField(u, { teamId: e.target.value || null })}>
      <option value="">— No team —</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
  const statusSelect = (u: AdminUser) => (
    <select className="stage-select" value={u.status} disabled={busyId === u.id} onChange={(e) => patchField(u, { status: e.target.value })}>
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
  const nameInput = (u: AdminUser) => (
    <input
      style={inputStyle}
      defaultValue={u.name}
      disabled={busyId === u.id}
      onBlur={(e) => e.target.value.trim() && e.target.value !== u.name && patchField(u, { name: e.target.value.trim() })}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
  const practiceInput = (u: AdminUser) => (
    <input
      style={inputStyle}
      placeholder="—"
      defaultValue={u.practiceArea ?? ""}
      disabled={busyId === u.id}
      onBlur={(e) => e.target.value !== (u.practiceArea ?? "") && patchField(u, { practiceArea: e.target.value.trim() || null })}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
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
    <>
      <div className="section-lbl">
        User management <span className="count">{users.length}</span>
      </div>
      <div className="scope-note">
        {counts.owner} owner{counts.owner !== 1 ? "s" : ""} · {counts.manager} manager
        {counts.manager !== 1 ? "s" : ""} · {counts.member} member{counts.member !== 1 ? "s" : ""}
        {counts.deactivated > 0 ? ` · ${counts.deactivated} deactivated` : ""}
      </div>
      <div className="subtabs">
        <button className={"subtab" + (view === "users" ? " on" : "")} onClick={() => setView("users")}>
          Users
        </button>
        <button className={"subtab" + (view === "groups" ? " on" : "")} onClick={() => setView("groups")}>
          User groups
        </button>
      </div>
      {view === "users" && (
        <div className="audit-filters">
          <input placeholder="Search name, email, or role" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn-sm btn-pl" onClick={() => setAdding((a) => !a)}>
            {adding ? "Cancel" : "＋ Add user"}
          </button>
        </div>
      )}
      {view === "users" && adding && (
        <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input style={{ ...inputStyle, flex: 2, minWidth: 180 }} placeholder="email@alphasights.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input style={{ ...inputStyle, flex: 1, minWidth: 120 }} placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="stage-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {cap(r)}
              </option>
            ))}
          </select>
          <select className="stage-select" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
            <option value="">— No team —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="btn-sm btn-pl" disabled={busyId === "new"} onClick={addUser}>
            Add
          </button>
        </div>
      )}
      {error && <div className="err-line">{error}</div>}
    </>
  );

  // "User groups" — same portal, organised by permission group. Works the
  // same on desktop and mobile (the grid collapses to one column).
  if (view === "groups") {
    return (
      <>
        {header}
        <UserGroupsView
          users={users}
          busyId={busyId}
          onChangeRole={changeRole}
          matrix={matrix}
          onTogglePermission={togglePermission}
        />
      </>
    );
  }

  if (isDesktop) {
    return (
      <>
        {header}
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Team</th>
              <th>Status</th>
              <th>Practice</th>
              <th>Last login</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} style={u.deactivatedAt ? { opacity: 0.55 } : undefined}>
                <td style={{ minWidth: 140 }}>{nameInput(u)}</td>
                <td style={{ fontSize: 11, color: "var(--soft)" }}>{u.email}</td>
                <td>{roleSelect(u)}</td>
                <td>{teamSelect(u)}</td>
                <td>{statusSelect(u)}</td>
                <td style={{ minWidth: 120 }}>{practiceInput(u)}</td>
                <td>{lastLogin(u.lastLoginAt)}</td>
                <td>{accessBtn(u)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="empty">No matching users.</div>}
      </>
    );
  }

  return (
    <>
      {header}
      {filtered.length === 0 && <div className="empty">No matching users.</div>}
      {filtered.map((u) => (
        <div key={u.id} className="member" style={u.deactivatedAt ? { opacity: 0.55 } : undefined}>
          <div className="member-top">
            <div style={{ flex: 1, minWidth: 0 }}>{nameInput(u)}</div>
            {accessBtn(u)}
          </div>
          <div className="assignee-sub" style={{ margin: "4px 0 8px" }}>
            {u.email} · last login {lastLogin(u.lastLoginAt)}
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
            <span className="cov-lbl">Status</span>
            {statusSelect(u)}
          </div>
          <div className="cov-row">
            <span className="cov-lbl">Practice</span>
            <div style={{ flex: 1, maxWidth: 160 }}>{practiceInput(u)}</div>
          </div>
        </div>
      ))}
    </>
  );
}
