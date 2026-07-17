import { api } from "../api/client";
import type { Person } from "../api/types";
import { useApp } from "../state/AppContext";
import type { Scope, Tab } from "./Header";

const NAV_ITEMS: { tab: Tab; icon: string; label: string }[] = [
  { tab: "PL", icon: "📋", label: "Project Leading" },
  { tab: "Delivery", icon: "📦", label: "Delivery" },
  { tab: "Ranking", icon: "📊", label: "Capacity Ranking" },
  { tab: "FirstDel", icon: "⏱", label: "First Deliverables" },
];

export default function Sidebar({
  tab,
  setTab,
  scope,
  setScope,
  plPendingCount,
  fdCount,
  onOpenTeam,
  onNewProject,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
  plPendingCount: number;
  fdCount: number;
  onOpenTeam: () => void;
  onNewProject: () => void;
}) {
  const { actor, setActor, logout } = useApp();

  const toggleEvening = async () => {
    const updated = await api.patch<Person>("/people/me/evening-coverage", {
      eveningCoverage: !actor.eveningCoverage,
    });
    setActor(updated);
  };

  const badgeFor = (t: Tab): number => {
    if (t === "PL") return plPendingCount;
    if (t === "FirstDel") return fdCount;
    return 0;
  };

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <img className="as-logo" src="/alphasights-logo.png" alt="AlphaSights" />
        <h1>CapTracker</h1>
      </div>

      <button className="sidebar-new-btn" onClick={onNewProject}>
        <span className="label-text">＋ New project</span>
      </button>

      <div className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button key={item.tab} className={tab === item.tab ? "active" : ""} onClick={() => setTab(item.tab)}>
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {badgeFor(item.tab) > 0 && <span className="badge">{badgeFor(item.tab)}</span>}
          </button>
        ))}
      </div>

      {/* Phase D, item 9 — moved up from the footer to directly under the
          First Deliverables nav item, per §4 Rule 3: reachable in one tap,
          not buried at the bottom. */}
      <button
        className={"eve-btn eve-btn-nav " + (actor.eveningCoverage ? "on" : "")}
        onClick={toggleEvening}
        title={actor.eveningCoverage ? "Evening coverage ON — tap to go off" : "Evening coverage OFF — tap to go on"}
      >
        <span className="nav-icon">{actor.eveningCoverage ? "🌙" : "💤"}</span>
        <span className="nav-label">{actor.eveningCoverage ? "Evening coverage: ON" : "Evening coverage: OFF"}</span>
      </button>

      <div className="sidebar-section-lbl">Scope</div>
      <div className="sidebar-scope">
        <button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>
          My view
        </button>
        <button className={scope === "team" ? "on" : ""} onClick={() => setScope("team")}>
          Team view
        </button>
      </div>

      <div className="sidebar-section-lbl">My Team</div>
      <div className="sidebar-nav">
        <button onClick={onOpenTeam}>
          <span className="nav-icon">👥</span>
          <span className="nav-label">My Team</span>
        </button>
        {(actor.isManager || actor.isOwner) && (
          <button className={tab === "AuditLog" ? "active" : ""} onClick={() => setTab("AuditLog")}>
            <span className="nav-icon">🕵</span>
            <span className="nav-label">Audit Log</span>
          </button>
        )}
        {actor.isOwner && (
          <button className={tab === "Users" ? "active" : ""} onClick={() => setTab("Users")}>
            <span className="nav-icon">🛠</span>
            <span className="nav-label">User Management</span>
          </button>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="persona" onClick={logout} title="Log out" style={{ width: "100%", justifyContent: "center" }}>
          <span style={{ color: "var(--soft)" }}>as</span> {actor.name}
          {actor.isOwner ? " (owner)" : actor.isManager ? " (mgr)" : ""}
        </button>
      </div>
    </nav>
  );
}
