import type { CSSProperties } from "react";
import { api } from "../api/client";
import type { Person } from "../api/types";
import Sheet from "../components/Sheet";
import type { Tab } from "../components/Header";
import { initials } from "../lib/format";
import { useApp } from "../state/AppContext";

const ico = (file: string): CSSProperties => ({ ["--ico"]: `url(/icons/${file})` } as CSSProperties);

/**
 * Mobile "More" sheet — everything that isn't one of the four bottom-nav
 * destinations: Ghost Ranking, the role-gated screens (Audit Log, User
 * Management), My Team + Sunday rota, the evening-coverage switch, and the
 * profile/logout row. Role gates mirror the server's (hiding is UX, the API
 * enforces).
 */
export default function MoreSheet({
  onClose,
  setTab,
  onOpenTeam,
  onOpenRota,
}: {
  onClose: () => void;
  setTab: (t: Tab) => void;
  onOpenTeam: () => void;
  onOpenRota: () => void;
}) {
  const { actor, setActor, logout } = useApp();

  const go = (t: Tab) => {
    setTab(t);
    onClose();
  };

  const toggleEvening = async () => {
    const updated = await api.patch<Person>("/people/me/evening-coverage", {
      eveningCoverage: !actor.eveningCoverage,
    });
    setActor(updated);
  };

  return (
    <Sheet onClose={onClose}>
      <h2>More</h2>
      <div className="sub">Everything else, one tap away.</div>

      <button className="more-item" onClick={() => go("GhostRanking")}>
        <span className="ico" style={ico("ghost.png")} aria-hidden="true" />
        Ghost Ranking
        <span className="more-chevron">›</span>
      </button>

      <button className="more-item" onClick={() => { onClose(); onOpenTeam(); }}>
        <span className="ico" style={ico("team.png")} aria-hidden="true" />
        My Team
        <span className="more-chevron">›</span>
      </button>

      <button className="more-item" onClick={() => { onClose(); onOpenRota(); }}>
        <span className="ico" style={ico("first-deliverables.png")} aria-hidden="true" />
        Sunday rota
        <span className="more-chevron">›</span>
      </button>

      {(actor.isManager || actor.isOwner) && (
        <button className="more-item" onClick={() => go("AuditLog")}>
          <span className="ico" style={ico("audit.png")} aria-hidden="true" />
          Audit Log
          <span className="more-gate">Managers</span>
        </button>
      )}

      {actor.isOwner && (
        <button className="more-item" onClick={() => go("Users")}>
          <span className="ico" style={ico("users.png")} aria-hidden="true" />
          User Management
          <span className="more-gate" style={{ background: "var(--pl-soft)", color: "var(--pl)" }}>Owners</span>
        </button>
      )}

      <button className="more-item" onClick={toggleEvening}>
        <span className="ico" style={ico("moon.svg")} aria-hidden="true" />
        Evening coverage
        <span className={"toggle-switch " + (actor.eveningCoverage ? "on" : "")} style={{ marginLeft: "auto", background: actor.eveningCoverage ? "var(--green)" : "var(--line)" }}>
          <span className="thumb" />
        </span>
      </button>

      <div className="more-persona">
        <div className="avatar">{initials(actor.name)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {actor.name}
            {actor.isOwner ? " (owner)" : actor.isManager ? " (mgr)" : ""}
          </div>
          <div style={{ fontSize: 11, color: "var(--soft)" }}>{actor.email}</div>
        </div>
        <button style={{ fontSize: 12, fontWeight: 700, color: "var(--red)" }} onClick={logout}>
          Log out
        </button>
      </div>

      <button className="close" onClick={onClose}>
        Close
      </button>
    </Sheet>
  );
}
