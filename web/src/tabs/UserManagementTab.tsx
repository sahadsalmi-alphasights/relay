import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePersistentState } from "../lib/persistentState";
import { api, ApiError } from "../api/client";
import type { AdminUser, Instance, PermissionMatrix, PermissionRole, PersonStatus, Role, Team } from "../api/types";
import InstancesView from "../components/InstancesView";
import UserGroupsView from "../components/UserGroupsView";
import UserTeamsView from "../components/UserTeamsView";
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
  // Full roster (lazy) — only the Teams/Groups tabs and the delete-reassign
  // picker need every person, so it's fetched on demand, never on mount.
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [view, setView] = usePersistentState<"users" | "groups" | "teams" | "instances">("relay.users.view", "users", ["users", "groups", "teams", "instances"]);
  const [search, setSearch] = useState("");
  // Paginated, instance-scoped roster for the Users tab (scales to thousands).
  const LIMIT = 50;
  const [roster, setRoster] = useState<AdminUser[]>([]);
  const [rosterTotal, setRosterTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [fLoc, setFLoc] = useState("");
  const [fDept, setFDept] = useState("");
  const [fBoard, setFBoard] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ email: string; name: string; role: Role; teamId: string }>({
    email: "",
    name: "",
    role: "member",
    teamId: "",
  });

  // Light load — teams, permission matrix, instances (with server-side member
  // counts). Deliberately NOT the full user list.
  const load = async () => {
    setError(null);
    try {
      const [t, p, inst] = await Promise.all([
        api.get<Team[]>("/teams"),
        api.get<{ matrix: PermissionMatrix }>("/users/permissions"),
        api.get<Instance[]>("/instances"),
      ]);
      setTeams(t);
      setMatrix(p.matrix);
      setInstances(inst);
      setReady(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load user management");
    }
  };

  // The paginated, filtered, instance-scoped roster for the Users tab. With no
  // location filter the server scopes to the caller's active instance.
  const loadRoster = async () => {
    const p = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (fLoc) p.set("location", fLoc);
    if (fDept) p.set("department", fDept);
    if (fBoard) p.set("board", fBoard);
    if (search.trim()) p.set("q", search.trim());
    try {
      const res = await api.get<{ users: AdminUser[]; total: number }>(`/users/roster?${p.toString()}`);
      setRoster(res.users);
      setRosterTotal(res.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load users");
    }
  };

  // Full roster, on demand (Teams/Groups tabs, reassign picker).
  const ensureUsers = async () => {
    if (users) return;
    try {
      setUsers(await api.get<AdminUser[]>("/users"));
    } catch {
      /* surfaced elsewhere */
    }
  };

  // Reload whatever the current view shows after a change.
  const refresh = async () => {
    await load();
    if (view === "users") await loadRoster();
    if (users) setUsers(await api.get<AdminUser[]>("/users"));
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  useEffect(() => {
    if (view === "users") void loadRoster();
    if (view === "groups" || view === "teams") void ensureUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, fLoc, fDept, fBoard, search, page, reloadTick]);

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await refresh();
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
  // Teams tab actions — same run() error surface as everything else here.
  const renameTeam = (t: Team, name: string) => run(t.id, () => api.patch(`/teams/${t.id}`, { name }));
  const assignManager = (t: Team, personId: string | null) =>
    run(t.id, () => api.patch(`/teams/${t.id}/manager`, { personId }));
  const deleteTeam = (t: Team, memberCount: number) => {
    if (memberCount > 0) {
      setError(`${t.name} still has ${memberCount} member${memberCount === 1 ? "" : "s"} — move them to another team first`);
      return;
    }
    if (!window.confirm(`Delete team ${t.name}? This cannot be undone.`)) return;
    void run(t.id, () => api.del(`/teams/${t.id}`));
  };
  const createTeamByName = async (name: string) => {
    setError(null);
    try {
      await api.post("/teams", { name });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the team");
    }
  };
  const createInstanceByName = async (name: string) => {
    setError(null);
    try {
      await api.post("/instances", { name });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the instance");
    }
  };
  // Delete flow: cascade removes the person's footprint (audit rows are kept,
  // unattributed). If they lead projects the server answers 409 and we open
  // the reassignment picker — choose the new PL, then delete proceeds.
  const [reassign, setReassign] = useState<{ user: AdminUser; to: string } | null>(null);
  const attemptDelete = async (u: AdminUser, reassignPlTo?: string) => {
    setBusyId(u.id);
    setError(null);
    try {
      await api.del(`/users/${u.id}${reassignPlTo ? `?reassignPlTo=${reassignPlTo}` : ""}`);
      setReassign(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.message.includes("take them over")) {
        setError(err.message);
        void ensureUsers(); // need the full list to pick a new PL
        setReassign({ user: u, to: "" });
      } else {
        setError(err instanceof ApiError ? err.message : "That change could not be saved");
      }
    } finally {
      setBusyId(null);
    }
  };
  const deleteUser = (u: AdminUser) => {
    if (
      !window.confirm(
        `Permanently delete ${u.name}? Their assignments, notifications and personal data are removed; audit history is kept without attribution. If they lead projects, you'll pick who takes those over.`
      )
    )
      return;
    void attemptDelete(u);
  };

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

  // The Users tab renders the server-paginated roster directly (already
  // filtered + searched server-side).
  const filtered = roster;
  const pageCount = Math.max(1, Math.ceil(rosterTotal / LIMIT));
  // Distinct filter options derived from the instance registry.
  const locations = useMemo(() => [...new Set(instances.map((i) => i.city).filter(Boolean))] as string[], [instances]);
  const departments = useMemo(
    () => [...new Set(instances.filter((i) => !fLoc || i.city === fLoc).map((i) => i.department).filter(Boolean))] as string[],
    [instances, fLoc]
  );
  const boards = useMemo(
    () => [...new Set(instances.filter((i) => (!fLoc || i.city === fLoc) && (!fDept || i.department === fDept)).map((i) => i.board).filter(Boolean))] as string[],
    [instances, fLoc, fDept]
  );
  const resetPage = () => setPage(1);

  if (error && !ready) {
    return (
      <>
        <div className="section-lbl">User management</div>
        <div className="empty">{error}</div>
      </>
    );
  }
  if (!ready) return <div className="empty">Loading…</div>;

  const pager =
    pageCount > 1 ? (
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 12 }}>
        <button className="btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
        <span style={{ fontSize: 12, color: "var(--soft)" }}>Page {page} of {pageCount} · {rosterTotal} users</span>
        <button className="btn-sm btn-ghost" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next ›</button>
      </div>
    ) : null;

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
  const SENIORITIES = ["Senior", "Mid", "Junior"];
  const senioritySelect = (u: AdminUser) => (
    <select
      className="stage-select"
      value={u.seniority ?? ""}
      disabled={busyId === u.id}
      onChange={(e) =>
        run(u.id, () => api.patch(`/vacation/people/${u.id}/seniority`, { seniority: e.target.value || null }))
      }
    >
      <option value="">—</option>
      {SENIORITIES.map((s) => (
        <option key={s} value={s}>
          {s}
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
      <span style={{ display: "inline-flex", gap: 6 }}>
        <button
          className={"btn-sm " + (u.deactivatedAt ? "btn-dl" : "btn-ghost")}
          disabled={busyId === u.id || isSelf}
          title={isSelf ? "You cannot deactivate yourself" : ""}
          onClick={() => toggleActive(u)}
        >
          {u.deactivatedAt ? "Reactivate" : "Deactivate"}
        </button>
        <button
          className="btn-sm btn-ghost btn-del-user"
          disabled={busyId === u.id || isSelf}
          title={isSelf ? "You cannot delete yourself" : "Permanently delete (only accounts without history)"}
          onClick={() => deleteUser(u)}
        >
          Delete
        </button>
      </span>
    );
  };

  const header = (
    <>
      <div className="hero-panel page-head" style={{ display: "block" }}>
        <div className="section-lbl">
          User management {view === "users" && <span className="count">{rosterTotal}</span>}
        </div>
        <div className="scope-note">
          {view === "users"
            ? "Scoped to your active instance — filter by location, department or board, or search."
            : "Owner portal."}
        </div>
        <div className="subtabs" style={{ marginTop: 8 }}>
          <button className={"subtab" + (view === "users" ? " on" : "")} onClick={() => setView("users")}>
            Users
          </button>
          <button className={"subtab" + (view === "groups" ? " on" : "")} onClick={() => setView("groups")}>
            User groups
          </button>
          <button className={"subtab" + (view === "teams" ? " on" : "")} onClick={() => setView("teams")}>
            Teams
          </button>
          <button className={"subtab" + (view === "instances" ? " on" : "")} onClick={() => setView("instances")}>
            Instances
          </button>
        </div>
      </div>
      {view === "users" && (
        <div className="audit-filters" style={{ flexWrap: "wrap" }}>
          <select className="stage-select" value={fLoc} onChange={(e) => { setFLoc(e.target.value); setFDept(""); setFBoard(""); resetPage(); }}>
            <option value="">Active instance</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {fLoc && (
            <select className="stage-select" value={fDept} onChange={(e) => { setFDept(e.target.value); setFBoard(""); resetPage(); }}>
              <option value="">All departments</option>
              {departments.map((dep) => <option key={dep} value={dep}>{dep}</option>)}
            </select>
          )}
          {fLoc && boards.length > 0 && (
            <select className="stage-select" value={fBoard} onChange={(e) => { setFBoard(e.target.value); resetPage(); }}>
              <option value="">All boards</option>
              {boards.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <input placeholder="Search name or email" value={search} onChange={(e) => { setSearch(e.target.value); resetPage(); }} style={{ flex: 1, minWidth: 180 }} />
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
      {view === "users" && reassign && (
        <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>
            Hand {reassign.user.name}'s projects to:
          </span>
          <select
            className="stage-select"
            value={reassign.to}
            onChange={(e) => setReassign({ ...reassign, to: e.target.value })}
          >
            <option value="">— Pick the new PL —</option>
            {(users ?? roster)
              .filter((u) => u.id !== reassign.user.id && !u.deactivatedAt)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
          <button
            className="btn-sm btn-pl"
            disabled={!reassign.to || busyId === reassign.user.id}
            onClick={() => attemptDelete(reassign.user, reassign.to)}
          >
            Reassign & delete
          </button>
          <button className="btn-sm btn-ghost" onClick={() => setReassign(null)}>
            Cancel
          </button>
        </div>
      )}
    </>
  );

  // "User groups" — same portal, organised by permission group. Works the
  // same on desktop and mobile (the grid collapses to one column).
  if (view === "groups") {
    return (
      <>
        {header}
        <UserGroupsView
          users={users ?? []}
          busyId={busyId}
          onChangeRole={changeRole}
          matrix={matrix}
          onTogglePermission={togglePermission}
        />
      </>
    );
  }

  if (view === "instances") {
    return (
      <>
        {header}
        <InstancesView instances={instances} teams={teams} onCreate={createInstanceByName} onChanged={load} />
      </>
    );
  }

  if (view === "teams") {
    return (
      <>
        {header}
        <UserTeamsView
          teams={teams}
          users={users ?? []}
          busyId={busyId}
          onRename={renameTeam}
          onAssignManager={assignManager}
          onDelete={deleteTeam}
          onCreate={createTeamByName}
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
              <th>Seniority</th>
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
                <td>{senioritySelect(u)}</td>
                <td style={{ minWidth: 120 }}>{practiceInput(u)}</td>
                <td>{lastLogin(u.lastLoginAt)}</td>
                <td>{accessBtn(u)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="empty">No matching users.</div>}
        {pager}
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
            <span className="cov-lbl">Seniority</span>
            {senioritySelect(u)}
          </div>
          <div className="cov-row">
            <span className="cov-lbl">Practice</span>
            <div style={{ flex: 1, maxWidth: 160 }}>{practiceInput(u)}</div>
          </div>
        </div>
      ))}
      {pager}
    </>
  );
}
