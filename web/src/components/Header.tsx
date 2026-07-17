import { api } from "../api/client";
import type { Person } from "../api/types";
import { dubaiHour, dubaiMinute } from "../lib/time";
import { initials } from "../lib/format";
import { useApp } from "../state/AppContext";
import type { LiveStatus } from "../lib/useLiveSocket";
import type { NotificationsState } from "../lib/useNotifications";
import NotificationBell from "./NotificationBell";

export type Tab = "PL" | "Delivery" | "Ranking" | "FirstDel" | "AuditLog";
export type Scope = "mine" | "team";

export default function Header({
  tab,
  setTab,
  scope,
  setScope,
  plPendingCount,
  fdCount,
  onOpenTeam,
  liveStatus,
  notif,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
  plPendingCount: number;
  fdCount: number;
  onOpenTeam: () => void;
  liveStatus: LiveStatus;
  notif: NotificationsState;
}) {
  const { actor, setActor, nowMs, demoHour, setDemoHour, effectiveHour, effectiveAfterHours, logout } = useApp();

  const toggleEvening = async () => {
    const updated = await api.patch<Person>("/people/me/evening-coverage", {
      eveningCoverage: !actor.eveningCoverage,
    });
    setActor(updated);
  };

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
          <h1>Relay</h1>
          <span>capacity &amp; delivery</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="persona" onClick={logout} title="Log out and switch seeded user">
            <span style={{ color: "var(--soft)" }}>as</span> {actor.name}
            {actor.isManager ? " (mgr)" : ""}
          </button>
          <button
            className={"eve-btn " + (actor.eveningCoverage ? "on" : "")}
            onClick={toggleEvening}
            title={
              actor.eveningCoverage
                ? "Evening coverage ON — tap to go off"
                : "Evening coverage OFF — tap to go on"
            }
          >
            {actor.eveningCoverage ? "🌙" : "💤"}
          </button>
          <button className="profile-btn" onClick={onOpenTeam} title="My team">
            {initials(actor.name)}
          </button>
          <NotificationBell notif={notif} />
        </div>
      </div>
      <div className="controls">
        <div className="seg">
          <button className={tab === "PL" ? "on-pl" : ""} onClick={() => setTab("PL")}>
            Leading{plPendingCount > 0 && <span className="badge">{plPendingCount}</span>}
          </button>
          <button className={tab === "Delivery" ? "on-dl" : ""} onClick={() => setTab("Delivery")}>
            Delivery
          </button>
          <button className={tab === "Ranking" ? "on-rk" : ""} onClick={() => setTab("Ranking")}>
            Capacity
          </button>
          <button className={tab === "FirstDel" ? "on-fd" : ""} onClick={() => setTab("FirstDel")}>
            1st Del{fdCount ? ` · ${fdCount}` : ""}
          </button>
          {/* docs/AUDIT_LOG_SPEC.md — audit trails are sensitive; only a
              manager sees this entry at all, same gate the read API itself
              enforces server-side (never rely on hiding the button alone). */}
          {actor.isManager && (
            <button className={tab === "AuditLog" ? "on-al" : ""} onClick={() => setTab("AuditLog")}>
              Audit
            </button>
          )}
        </div>
        <div className="scope">
          <button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>
            My view
          </button>
          <button className={scope === "team" ? "on" : ""} onClick={() => setScope("team")}>
            Team view
          </button>
        </div>
      </div>
      <div className="timebar">
        <span
          className={"live-dot " + (liveStatus === "connected" ? "on" : "off")}
          title={liveStatus === "connected" ? "Live updates connected" : "Reconnecting…"}
        />
        <span className="clock-time">🇦🇪 {timeStr} Dubai</span>
        <span className="time-cap">
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
