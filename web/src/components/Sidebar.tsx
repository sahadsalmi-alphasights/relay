import type { CSSProperties } from "react";
import { api } from "../api/client";
import type { Person } from "../api/types";
import { useApp } from "../state/AppContext";
import type { Scope, Tab } from "./Header";

const NAV_ITEMS: { tab: Tab; icon: string; label: string }[] = [
  { tab: "PL", icon: "pl.png", label: "Project Leading" },
  { tab: "Delivery", icon: "delivery.png", label: "Delivery" },
  { tab: "Ranking", icon: "ranking.png", label: "Capacity Ranking" },
  // "Invisible competition" — same design/component as Capacity Ranking,
  // filtered to ghost-flagged people; same visibility (no manager gate).
  { tab: "GhostRanking", icon: "ghost.png", label: "Ghost Ranking" },
  { tab: "FirstDel", icon: "first-deliverables.png", label: "First Deliverables" },
];

/** AlphaSights deck icon as a CSS mask (auto-coloured via currentColor). */
const ico = (file: string): CSSProperties => ({ ["--ico"]: `url(/icons/${file})` } as CSSProperties);

export default function Sidebar({
  tab,
  setTab,
  scope,
  setScope,
  teamView,
  setTeamView,
  plPendingCount,
  fdCount,
  onOpenTeam,
  onNewProject,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
  /** "" = own team, "all" = whole BU, else a team id. */
  teamView: string;
  setTeamView: (t: string) => void;
  plPendingCount: number;
  fdCount: number;
  onOpenTeam: () => void;
  onNewProject: () => void;
}) {
  const { actor, setActor, logout, teams } = useApp();

  const toggleEvening = async () => {
    const updated = await api.patch<Person>("/people/me/evening-coverage", {
      eveningCoverage: !actor.eveningCoverage,
    });
    setActor(updated);
  };

  const toggleLunch = async () => {
    const updated = await api.patch<Person>("/people/me/lunch", { outToLunch: !actor.outToLunch });
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
        <span className="ico" style={ico("new.png")} aria-hidden="true" />
        <span className="label-text">New project</span>
      </button>

      <div className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button key={item.tab} className={tab === item.tab ? "active" : ""} onClick={() => setTab(item.tab)}>
            <span className="nav-icon ico" style={ico(item.icon)} aria-hidden="true" />
            <span className="nav-label">{item.label}</span>
            {badgeFor(item.tab) > 0 && <span className="badge">{badgeFor(item.tab)}</span>}
          </button>
        ))}
      </div>

      {/* §4 Rule 3 — evening-coverage toggle, reachable in one tap.
          Manager feedback batch, item 6 — redesigned as an actual
          track-and-thumb switch (the universally-recognised on/off pattern)
          with a plain row background, green only on the switch itself when
          on, so it reads as a toggle control at a glance instead of another
          nav button. Keeps the AlphaSights deck icon from our theme. */}
      <button
        className="eve-toggle-row"
        onClick={toggleEvening}
        title={actor.eveningCoverage ? "Evening coverage ON — tap to go off" : "Evening coverage OFF — tap to go on"}
      >
        <span className="nav-icon ico" style={ico("moon.svg")} aria-hidden="true" />
        <span className="nav-label">Evening coverage</span>
        <span className={"toggle-switch " + (actor.eveningCoverage ? "on" : "")}>
          <span className="thumb" />
        </span>
      </button>

      {/* "Out to Lunch" — same self-serve pattern as evening coverage, one
          tap: while on, no new projects are allocated (existing work stays)
          and the ranking shows a red "Lunch" chip. */}
      <button
        className="eve-toggle-row"
        onClick={toggleLunch}
        title={actor.outToLunch ? "Out to Lunch ON — no new allocations. Tap to come back." : "Out to Lunch OFF — tap when you head out"}
      >
        <span className="nav-icon" aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>🍱</span>
        <span className="nav-label">Out to Lunch</span>
        <span className={"toggle-switch lunch " + (actor.outToLunch ? "on" : "")}>
          <span className="thumb" />
        </span>
      </button>

      <div className="sidebar-section-lbl">Scope</div>
      <div className="sidebar-scope">
        <button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>
          My view
        </button>
        <button className={scope === "team" ? "on" : ""} onClick={() => setScope("team")}>
          Team view
        </button>
        {/* Which team? Own by default; any other team is view-only for plain
            members (write routes enforce it — this is transparency, not power).
            "All teams" is the whole consulting BU at once. */}
        {scope === "team" && (
          <select
            className="team-picker"
            value={teamView}
            onChange={(e) => setTeamView(e.target.value)}
            title="Choose which team to view"
          >
            <option value="">My team</option>
            {teams
              .filter((t) => t.id !== actor.teamId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            <option value="all">All teams — entire BU</option>
          </select>
        )}
      </div>

      {/* Management group, pinned to the bottom and separated from Scope. */}
      <div className="sidebar-team">
        <div className="sidebar-section-lbl">My Team</div>
        <div className="sidebar-nav">
          <button onClick={onOpenTeam}>
            <span className="nav-icon ico" style={ico("team.png")} aria-hidden="true" />
            <span className="nav-label">My Team</span>
          </button>
          {(actor.isManager || actor.isOwner) && (
            <button className={tab === "AuditLog" ? "active" : ""} onClick={() => setTab("AuditLog")}>
              <span className="nav-icon ico" style={ico("audit.png")} aria-hidden="true" />
              <span className="nav-label">Audit Log</span>
            </button>
          )}
          {actor.isOwner && (
            <button className={tab === "Users" ? "active" : ""} onClick={() => setTab("Users")}>
              <span className="nav-icon ico" style={ico("users.png")} aria-hidden="true" />
              <span className="nav-label">User Management</span>
            </button>
          )}
        </div>
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
