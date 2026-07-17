import { useEffect, useRef } from "react";
import { dubaiHour, dubaiMinute } from "../lib/time";
import { useApp } from "../state/AppContext";
import type { LiveStatus } from "../lib/useLiveSocket";
import type { NotificationsState } from "../lib/useNotifications";
import NotificationBell from "./NotificationBell";

export default function TopBar({ liveStatus, notif }: { liveStatus: LiveStatus; notif: NotificationsState }) {
  const { nowMs, demoHour, setDemoHour, effectiveHour, effectiveAfterHours } = useApp();
  const barRef = useRef<HTMLDivElement>(null);

  /**
   * Phase D (v2), item 11 — the team capacity panel (ProjectLeadingTab)
   * pins itself below this bar, not under it. Rather than hardcoding a
   * pixel guess that drifts if this bar's content ever wraps or grows, we
   * measure its real rendered height and publish it as a shared layout
   * token (--topbar-h) any sticky element below can read from. A
   * ResizeObserver keeps it correct across demo-clock content changes and
   * window resizes, not just on first mount.
   */
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const liveHour = dubaiHour(nowMs);
  const liveMinute = dubaiMinute(nowMs);
  const timeStr =
    demoHour != null
      ? `${String(demoHour).padStart(2, "0")}:00 (demo)`
      : `${String(liveHour).padStart(2, "0")}:${String(liveMinute).padStart(2, "0")}`;

  return (
    <div className="topbar" ref={barRef}>
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
