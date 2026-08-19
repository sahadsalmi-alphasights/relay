import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api, ApiError } from "../api/client";
import type { AdminUser, Instance, Role, Team } from "../api/types";

const ROLES: Role[] = ["owner", "manager", "member"];
const STATUSES = ["Available", "On vacation", "Sick", "Offline"];
const PAGE = 25;

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  font: "inherit",
  fontSize: 13,
  background: "var(--surface)",
  color: "var(--ink)",
};

const AV = ["#FC8300", "#2C6FD6", "#2C9E63", "#9147C9", "#D14343", "#0E8C7F", "#C77D12", "#5661D6"];
const initials = (n: string) => n.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const avColor = (n: string) => AV[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];

function Avatar({ name }: { name: string }) {
  return (
    <div style={{ width: 30, height: 30, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, color: "#fff", background: avColor(name) }}>
      {initials(name)}
    </div>
  );
}

const statusMini = (s: string) => (s === "Offline" ? "off" : s === "Available" ? "free" : "vac");

/**
 * User management → Instances. A master–detail membership manager: the isolated
 * instances live in the left rail; selecting one shows its roster on the right,
 * where an owner can add/remove people and edit role/team/status inline. Adding
 * pulls from a company-wide, search-driven candidate list (everyone NOT already
 * in the instance) so it scales to thousands of users. All writes are the same
 * owner-only, audit-logged endpoints used by the Users tab.
 */
export default function InstancesView({
  instances,
  teams,
  onCreate,
  onChanged,
}: {
  instances: Instance[];
  teams: Team[];
  onCreate: (name: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [instFilter, setInstFilter] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(instances[0]?.key ?? null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // BambooHR seed import (preview-then-apply).
  type Group = { city: string; department: string; key: string | null; existing: boolean; people: number };
  type Preview = { ok: boolean; error?: string; totalEmployees?: number; skippedNoEmail?: number; skippedNoTuple?: number; withTuple?: number; groups?: Group[]; newInstances?: number; existingInstances?: number; matchedUsers?: number; newUsers?: number };
  type Applied = { ok: boolean; error?: string; instancesCreated?: number; instancesTotal?: number; usersCreated?: number; usersReassigned?: number; skippedNoEmail?: number; skippedNoTuple?: number };
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importBusy, setImportBusy] = useState<"preview" | "apply" | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);

  // Members of the selected instance (paginated, searchable).
  const [members, setMembers] = useState<AdminUser[]>([]);
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // "Add members" drawer — candidate search across everyone not in the instance.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [candSearch, setCandSearch] = useState("");
  const [candidates, setCandidates] = useState<AdminUser[]>([]);
  const [candTotal, setCandTotal] = useState(0);
  const [loadingCand, setLoadingCand] = useState(false);

  // Keep a valid selection as instances load / change.
  useEffect(() => {
    if (!instances.length) { setSelectedKey(null); return; }
    if (!selectedKey || !instances.some((i) => i.key === selectedKey)) setSelectedKey(instances[0].key);
  }, [instances, selectedKey]);

  const selected = instances.find((i) => i.key === selectedKey) ?? null;

  const loadMembers = useCallback(async () => {
    if (!selectedKey) { setMembers([]); setMemberTotal(0); return; }
    setLoadingMembers(true);
    try {
      const p = new URLSearchParams({ instance: selectedKey, page: String(memberPage), limit: String(PAGE) });
      if (memberSearch.trim()) p.set("q", memberSearch.trim());
      const res = await api.get<{ users: AdminUser[]; total: number }>(`/users/roster?${p.toString()}`);
      setMembers(res.users);
      setMemberTotal(res.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load members");
    } finally {
      setLoadingMembers(false);
    }
  }, [selectedKey, memberPage, memberSearch]);

  const loadCandidates = useCallback(async () => {
    if (!selectedKey) return;
    setLoadingCand(true);
    try {
      const p = new URLSearchParams({ excludeInstance: selectedKey, limit: String(PAGE) });
      if (candSearch.trim()) p.set("q", candSearch.trim());
      const res = await api.get<{ users: AdminUser[]; total: number }>(`/users/roster?${p.toString()}`);
      setCandidates(res.users);
      setCandTotal(res.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load people");
    } finally {
      setLoadingCand(false);
    }
  }, [selectedKey, candSearch]);

  // Reset to page 1 when the instance or member search changes.
  useEffect(() => { setMemberPage(1); }, [selectedKey, memberSearch]);
  // Debounced member load.
  const t1 = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(t1.current);
    t1.current = setTimeout(loadMembers, memberSearch ? 220 : 0);
    return () => clearTimeout(t1.current);
  }, [loadMembers, memberSearch]);
  // Debounced candidate load (only while the drawer is open).
  const t2 = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!drawerOpen) return;
    clearTimeout(t2.current);
    t2.current = setTimeout(loadCandidates, candSearch ? 220 : 0);
    return () => clearTimeout(t2.current);
  }, [drawerOpen, loadCandidates, candSearch]);

  const afterMutate = async () => { await loadMembers(); if (drawerOpen) await loadCandidates(); onChanged(); };

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id); setError(null);
    try { await fn(); await afterMutate(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "That change could not be saved"); }
    finally { setBusyId(null); }
  };

  const addMember = (u: AdminUser) =>
    run(u.id, () => api.patch(`/users/${u.id}/instances`, { instanceKeys: [...new Set([...(u.instanceKeys ?? []), selectedKey])] }));
  const removeMember = (u: AdminUser) =>
    run(u.id, () => api.patch(`/users/${u.id}/instances`, { instanceKeys: (u.instanceKeys ?? []).filter((k) => k !== selectedKey) }));
  const changeRole = (u: AdminUser, role: Role) => run(u.id, () => api.patch(`/users/${u.id}/role`, { role }));
  const changeStatus = (u: AdminUser, status: string) => run(u.id, () => api.patch(`/users/${u.id}`, { status }));
  const changeTeam = (u: AdminUser, teamId: string) => run(u.id, () => api.patch(`/users/${u.id}`, { teamId: teamId || null }));

  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true); setError(null);
    try { await onCreate(newName.trim()); setNewName(""); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not create the instance"); }
    finally { setCreating(false); }
  };

  const runPreview = async () => {
    setImportBusy("preview"); setError(null); setApplied(null);
    try { setPreview(await api.get<Preview>("/instances/import/preview")); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not reach BambooHR"); }
    finally { setImportBusy(null); }
  };
  const runApply = async () => {
    setImportBusy("apply"); setError(null);
    try {
      const res = await api.post<Applied>("/instances/import/apply");
      setApplied(res);
      onChanged();
      await loadMembers();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Import failed"); }
    finally { setImportBusy(null); }
  };

  const shown = instances.filter((i) => i.name.toLowerCase().includes(instFilter.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(memberTotal / PAGE));

  return (
    <>
      {error && <div className="err-line">{error}</div>}

      {/* ---- BambooHR seed import ---- */}
      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Seed from BambooHR</div>
            <div style={{ fontSize: 12, color: "var(--soft)" }}>
              Creates instances and users from the BambooHR directory — the same (city · department) mapping Okta uses at login. Preview first; nothing is written until you apply.
            </div>
          </div>
          <button className="btn-sm btn-ghost" disabled={importBusy !== null} onClick={() => { setImportOpen((o) => !o); if (!importOpen && !preview) runPreview(); }}>
            {importOpen ? "Hide" : "Import from BambooHR"}
          </button>
        </div>

        {importOpen && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            {importBusy === "preview" && <div style={{ fontSize: 13, color: "var(--soft)" }}>Reading the BambooHR directory…</div>}
            {preview && !preview.ok && <div className="err-line">{preview.error}</div>}
            {preview && preview.ok && (
              <>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, marginBottom: 10 }}>
                  <span><b style={{ fontVariantNumeric: "tabular-nums" }}>{preview.totalEmployees}</b> in directory</span>
                  <span><b style={{ color: "var(--green)" }}>{preview.newInstances}</b> new instance(s), {preview.existingInstances} existing</span>
                  <span><b style={{ color: "var(--green)" }}>{preview.newUsers}</b> user(s) to create, {preview.matchedUsers} already here</span>
                  {(preview.skippedNoTuple || preview.skippedNoEmail) ? (
                    <span style={{ color: "var(--amber)" }}>skipped {preview.skippedNoTuple} without office, {preview.skippedNoEmail} without email</span>
                  ) : null}
                </div>
                <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                  <table className="admin-table">
                    <thead><tr><th>Office (city · department)</th><th>Status</th><th style={{ textAlign: "right" }}>People</th></tr></thead>
                    <tbody>
                      {preview.groups?.map((g) => (
                        <tr key={g.city + g.department}>
                          <td style={{ fontWeight: 600 }}>{g.city} · {g.department}</td>
                          <td>{g.existing ? <span className="mini busy">existing</span> : <span className="mini free">new</span>}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{g.people}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
                  <button className="btn-sm btn-pl" disabled={importBusy !== null} onClick={runApply}>
                    {importBusy === "apply" ? "Applying…" : `Apply — create ${preview.newInstances} instance(s) & ${preview.newUsers} user(s)`}
                  </button>
                  <button className="btn-sm btn-ghost" disabled={importBusy !== null} onClick={runPreview}>Refresh preview</button>
                </div>
              </>
            )}
            {applied && applied.ok && (
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--green)" }}>
                ✓ Imported — {applied.instancesCreated} instance(s) created ({applied.instancesTotal} total), {applied.usersCreated} user(s) created, {applied.usersReassigned} re-homed.
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 300px) 1fr", gap: 14, alignItems: "start" }} className="inst-grid">
        {/* ---- left rail: instance list ---- */}
        <aside className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--line)" }}>
            <input style={inputStyle} placeholder="Filter instances…" value={instFilter} onChange={(e) => setInstFilter(e.target.value)} />
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 6, display: "flex", flexDirection: "column", gap: 2, maxHeight: 520, overflow: "auto" }}>
            {shown.map((i) => {
              const on = i.key === selectedKey;
              return (
                <li key={i.key}>
                  <button
                    onClick={() => { setSelectedKey(i.key); setDrawerOpen(false); }}
                    style={{
                      width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                      padding: "9px 10px", borderRadius: 9, font: "inherit",
                      border: "1px solid " + (on ? "var(--pl)" : "transparent"),
                      background: on ? "var(--pl-soft)" : "transparent", color: "var(--ink)",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}</span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--soft)", fontFamily: "var(--mono, monospace)" }}>{i.key}</span>
                    </span>
                    <span className="section-lbl" style={{ margin: 0 }}>
                      <span className="count" style={{ fontVariantNumeric: "tabular-nums" }}>{i.memberCount ?? 0}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li style={{ padding: 12, color: "var(--soft)", fontSize: 12 }}>No instances match.</li>}
          </ul>
          <div style={{ padding: 10, borderTop: "1px solid var(--line)", display: "flex", gap: 6 }}>
            <input style={inputStyle} placeholder="New instance name…" value={newName}
              onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
            <button className="btn-sm btn-pl" disabled={creating || !newName.trim()} onClick={create} style={{ whiteSpace: "nowrap" }}>＋ Create</button>
          </div>
        </aside>

        {/* ---- right: selected instance roster ---- */}
        <section className="card" style={{ padding: 0, overflow: "hidden" }}>
          {!selected ? (
            <div className="empty"><b>No instance selected</b>Create one to start assigning people.</div>
          ) : (
            <>
              <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: "var(--soft)", marginTop: 4 }}>
                    <b style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{memberTotal}</b> member{memberTotal === 1 ? "" : "s"}
                    {selected.city && <span> · {[selected.city, selected.department, selected.board].filter(Boolean).join(" · ")}</span>}
                  </div>
                </div>
                <button className="btn-sm btn-pl" onClick={() => { setDrawerOpen((o) => !o); setCandSearch(""); }}>
                  {drawerOpen ? "Close" : "＋ Add members"}
                </button>
              </div>

              {/* add-members drawer */}
              {drawerOpen && (
                <div style={{ borderBottom: "1px solid var(--line)", background: "var(--bg)", padding: "12px 16px" }}>
                  <input style={{ ...inputStyle, maxWidth: 320 }} autoFocus placeholder="Search people not in this instance…"
                    value={candSearch} onChange={(e) => setCandSearch(e.target.value)} />
                  <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, maxHeight: 260, overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                    {loadingCand && <li style={{ color: "var(--soft)", fontSize: 12, padding: 8 }}>Searching…</li>}
                    {!loadingCand && candidates.map((c) => (
                      <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: 8 }}>
                        <Avatar name={c.name} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: "var(--soft)" }}>{c.email} · {(c.instanceKeys ?? []).length} instance(s)</div>
                        </div>
                        <button className="btn-sm btn-pl" disabled={busyId === c.id} onClick={() => addMember(c)}>＋ Add</button>
                      </li>
                    ))}
                    {!loadingCand && candidates.length === 0 && (
                      <li style={{ color: "var(--soft)", fontSize: 12, padding: 8 }}>
                        {candSearch ? "No matching people are outside this instance." : "Type to search people to add."}
                      </li>
                    )}
                    {!loadingCand && candTotal > candidates.length && (
                      <li style={{ color: "var(--soft)", fontSize: 11, padding: "6px 8px" }}>Showing {candidates.length} of {candTotal} — refine your search.</li>
                    )}
                  </ul>
                </div>
              )}

              {/* member search */}
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
                <input style={{ ...inputStyle, maxWidth: 280 }} placeholder="Search members…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
              </div>

              <div style={{ overflow: "auto", maxHeight: 560 }}>
                <table className="admin-table">
                  <thead>
                    <tr><th>Person</th><th>Role</th><th>Team</th><th>Status</th><th>Also in</th><th></th></tr>
                  </thead>
                  <tbody>
                    {members.map((m) => {
                      const also = (m.instanceKeys ?? []).filter((k) => k !== selectedKey);
                      const alsoNames = also.map((k) => instances.find((i) => i.key === k)?.name.split(" · ")[0] ?? k);
                      return (
                        <tr key={m.id} style={{ opacity: busyId === m.id ? 0.5 : 1 }}>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <Avatar name={m.name} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.name}</div>
                                <div style={{ fontSize: 11, color: "var(--soft)" }}>{m.email}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <select className="stage-select" value={m.role} disabled={busyId === m.id} onChange={(e) => changeRole(m, e.target.value as Role)}>
                              {ROLES.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="stage-select" value={m.teamId ?? ""} disabled={busyId === m.id} onChange={(e) => changeTeam(m, e.target.value)}>
                              <option value="">— No team —</option>
                              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="stage-select" value={m.status} disabled={busyId === m.id} onChange={(e) => changeStatus(m, e.target.value)}>
                              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td style={{ fontSize: 11, color: "var(--soft)" }}>
                            {also.length ? <><b>{also.length}</b> · {alsoNames.join(", ")}</> : "—"}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <button className="btn-sm btn-ghost" style={{ color: "var(--red)" }} disabled={busyId === m.id} onClick={() => removeMember(m)}>Remove</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!loadingMembers && members.length === 0 && (
                  <div className="empty"><b>No one assigned yet</b>Use “＋ Add members” to bring people into this instance.</div>
                )}
              </div>

              {pageCount > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: 12, borderTop: "1px solid var(--line)" }}>
                  <button className="btn-sm btn-ghost" disabled={memberPage <= 1} onClick={() => setMemberPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
                  <span style={{ fontSize: 12, color: "var(--soft)" }}>Page {memberPage} of {pageCount} · {memberTotal} members</span>
                  <button className="btn-sm btn-ghost" disabled={memberPage >= pageCount} onClick={() => setMemberPage((p) => Math.min(pageCount, p + 1))}>Next ›</button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <p style={{ fontSize: 11, color: "var(--soft)", marginTop: 10 }}>
        Each instance is a fully isolated environment — users only ever see their own instance's data. A person can belong to
        several instances; “Also in” shows their other memberships. Okta’s department maps users automatically once configured.
      </p>

      <style>{`@media (max-width: 820px){ .inst-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}
