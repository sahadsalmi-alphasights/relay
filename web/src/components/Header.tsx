import { dubaiHour, dubaiMinute } from "../lib/time";
import { initials } from "../lib/format";
import { useApp } from "../state/AppContext";
import { useTheme } from "../lib/theme";
import type { LiveStatus } from "../lib/useLiveSocket";
import type { Notification as AppNotification } from "../api/types";
import type { NotificationsState } from "../lib/useNotifications";
import NotificationBell from "./NotificationBell";

export type Tab = "PL" | "Delivery" | "Ranking" | "GhostRanking" | "FirstDel" | "AuditLog" | "Users";
export type Scope = "mine" | "team";

/**
 * Mobile redesign — the header is chrome-light: brand, live Dubai-time pill,
 * dark-mode toggle, bell, avatar (My Team), then the scope control and a one
 * line pool caption. Navigation lives in the bottom bar (MobileNav); persona,
 * evening coverage and logout live in the More sheet.
 */
export default function Header({
  scope,
  setScope,
  teamView = "",
  setTeamView,
  onOpenTeam,
  liveStatus,
  notif,
  onOpenNotification,
}: {
  scope: Scope;
  setScope: (s: Scope) => void;
  /** "" = own team, "all" = whole BU, else a team id. */
  teamView?: string;
  setTeamView?: (t: string) => void;
  onOpenTeam: () => void;
  liveStatus: LiveStatus;
  notif: NotificationsState;
  onOpenNotification?: (n: AppNotification) => void;
}) {
  const { actor, nowMs, demoHour, setDemoHour, effectiveHour, effectiveAfterHours, teams } = useApp();
  const { theme, toggleTheme } = useTheme();

  const liveHour = dubaiHour(nowMs);
  const liveMinute = dubaiMinute(nowMs);
  const timeStr =
    demoHour != null
      ? `${String(demoHour).padStart(2, "0")}:00 (demo)`
      : `${String(liveHour).padStart(2, "0")}:${String(liveMinute).padStart(2, "0")}`;

  return (
    <div className="hdr">
      <div className="hdr-top">
        <div className="brand">
          <h1>CapTracker</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span className="time-pill" title={liveStatus === "connected" ? "Live updates connected" : "Reconnecting…"}>
            <span className={"live-dot " + (liveStatus === "connected" ? "on" : "off")} />
            🇦🇪 {timeStr}
          </span>
          <button
            className="theme-btn"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <NotificationBell notif={notif} onOpen={onOpenNotification} />
          <button className="profile-btn" onClick={onOpenTeam} title="My team">
            {initials(actor.name)}
          </button>
        </div>
      </div>
      <div className="controls">
        <div className="scope" style={{ marginTop: 0 }}>
          <button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>
            My view
          </button>
          <button className={scope === "team" ? "on" : ""} onClick={() => setScope("team")}>
            Team view
          </button>
          {scope === "team" && setTeamView && (
            <select className="team-picker team-picker-mobile" value={teamView} onChange={(e) => setTeamView(e.target.value)}>
              <option value="">My team</option>
              {teams
                .filter((t) => t.id !== actor.teamId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              <option value="all">All teams</option>
            </select>
          )}
        </div>
      </div>
      <div className="timebar">
        <span className="time-cap" style={{ borderLeft: "none", paddingLeft: 0 }}>
          {effectiveAfterHours ? "After hours — evening coverage only" : "Working hours"} ·{" "}
          {effectiveHour >= 15 ? "US pool live 2×" : "US pool asleep"} ·{" "}
          {effectiveHour < 15 ? "APAC live 2×" : "APAC done"}
        </span>
        {import.meta.env.DEV && (
          <div className="demo-clock">
            <input
              type="range"
              min={0}
              max={23}
              value={demoHour ?? liveHour}
              onChange={(e) => setDemoHour(Number(e.target.value))}
              title="Demo clock override — preview only, does not change real matching"
            />
            {demoHour != null && <button onClick={() => setDemoHour(null)}>Live</button>}
          </div>
        )}
      </div>
    </div>
  );
}
