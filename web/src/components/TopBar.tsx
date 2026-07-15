import { dubaiHour, dubaiMinute } from "../lib/time";
import { useApp } from "../state/AppContext";
import type { LiveStatus } from "../lib/useLiveSocket";
import type { NotificationsState } from "../lib/useNotifications";
import NotificationBell from "./NotificationBell";

export default function TopBar({ liveStatus, notif }: { liveStatus: LiveStatus; notif: NotificationsState }) {
  const { nowMs, demoHour, setDemoHour, effectiveHour, effectiveAfterHours } = useApp();

  const liveHour = dubaiHour(nowMs);
  const liveMinute = dubaiMinute(nowMs);
  const timeStr =
    demoHour != null
      ? `${String(demoHour).padStart(2, "0")}:00 (demo)`
      : `${String(liveHour).padStart(2, "0")}:${String(liveMinute).padStart(2, "0")}`;

  return (
    <div className="topbar">
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
      <div className="topbar-spacer" />
      <NotificationBell notif={notif} />
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
  );
}
