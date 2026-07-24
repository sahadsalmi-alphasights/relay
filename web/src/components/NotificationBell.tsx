import { useEffect, useState } from "react";
import type { Notification as AppNotification } from "../api/types";
import type { NotificationsState } from "../lib/useNotifications";
import { requestNotificationPermission, showBrowserNotification } from "../lib/pushNotifications";
import { isSoundEnabled, playNotificationSound, setSoundEnabled } from "../lib/notificationSound";
import { disablePush, enablePush, getPushSubscription, isPushSupported } from "../lib/webPush";

const notifSupported = typeof Notification !== "undefined";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/** Per-type icon chip — the visual index of the tray. */
const TYPE_META: Record<string, { icon: string; cls: string }> = {
  assigned: { icon: "🤝", cls: "teal" },
  delivery_logged: { icon: "📈", cls: "orange" },
  goal_change_requested: { icon: "✏️", cls: "amber" },
  goal_change_resolved: { icon: "✅", cls: "green" },
  stale_first_deliverable: { icon: "⏰", cls: "red" },
  open_pool: { icon: "📣", cls: "blue" },
  project_transferred: { icon: "⤴", cls: "teal" },
};

export default function NotificationBell({
  notif,
  onOpen,
}: {
  notif: NotificationsState;
  /** Clicking a notification navigates to (and highlights) what it's about — wired by Shell. */
  onOpen?: (n: AppNotification) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission>(notifSupported ? Notification.permission : "denied");
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  const toggleSound = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) playNotificationSound();
  };

  const enablePopups = async () => {
    const p = await requestNotificationPermission();
    setPerm(p);
    if (p === "granted") {
      void showBrowserNotification("Notifications enabled", "You'll get CapTracker pop-ups like this one.");
    }
  };

  useEffect(() => {
    getPushSubscription().then((sub) => setPushEnabled(!!sub));
  }, []);

  const togglePush = async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushEnabled) {
        await disablePush();
        setPushEnabled(false);
      } else {
        const result = await enablePush();
        setPushEnabled(result.ok);
        if (notifSupported) setPerm(Notification.permission);
        if (result.ok) {
          void showBrowserNotification("Push notifications on", "Chrome will notify you even when the tab is closed.");
        } else {
          // Never let the switch just snap back with no explanation.
          setPushError(result.reason);
        }
      }
    } catch {
      setPushError("Something went wrong turning push on — try again.");
    } finally {
      setPushBusy(false);
    }
  };

  const openNotification = (n: AppNotification) => {
    void notif.markRead(n.id);
    setOpen(false);
    onOpen?.(n);
  };

  return (
    <div className="bell-wrap">
      <button
        className={"eve-btn bell-btn" + (notif.unreadCount > 0 ? " has-unread" : "")}
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
      >
        {/* Bell drawn in the AlphaSights icon-pack line style (2.2 stroke,
            rounded caps, corner dot accent) — the pack itself has no bell.
            Grey when clear, bright red when anything is unread. */}
        <svg
          width="21"
          height="21"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          <circle cx="20.4" cy="4.2" r="1.5" fill="currentColor" stroke="none" />
        </svg>
        {notif.unreadCount > 0 && <span className="badge bell-badge">{notif.unreadCount}</span>}
      </button>
      {open && (
        <>
          <div className="notif-scrim" onClick={() => setOpen(false)} />
          <div className="notif-panel">
            <div className="notif-panel-header">
              <b>Notifications</b>
              {notif.unreadCount > 0 && <span className="notif-count">{notif.unreadCount} new</span>}
              <span className="notif-head-actions">
                {notif.unreadCount > 0 && (
                  <button className="notif-markall" onClick={() => notif.markAllRead()}>
                    Mark all read
                  </button>
                )}
                {notif.notifications.length > 0 && (
                  <button
                    className="notif-markall notif-clear"
                    onClick={() => {
                      if (window.confirm("Clear all notifications? They'll be permanently removed.")) {
                        void notif.clearAll();
                      }
                    }}
                  >
                    Clear all
                  </button>
                )}
              </span>
            </div>
            {notif.notifications.length === 0 ? (
              <div className="notif-empty">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--line)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                </svg>
                <div>You're all caught up</div>
              </div>
            ) : (
              <div className="notif-list">
                {notif.notifications.map((n) => {
                  const meta = TYPE_META[n.type] ?? { icon: "🔔", cls: "blue" };
                  return (
                    <button
                      key={n.id}
                      className={"notif-item" + (n.read ? "" : " unread")}
                      onClick={() => openNotification(n)}
                      title="Open what this is about"
                    >
                      <span className={"notif-ico " + meta.cls} aria-hidden="true">
                        {meta.icon}
                      </span>
                      <span className="notif-main">
                        <span className="notif-title">{n.title}</span>
                        <span className="notif-body">{n.body}</span>
                      </span>
                      <span className="notif-meta">
                        <span className="notif-time">{timeAgo(n.createdAt)}</span>
                        {!n.read && <span className="notif-dot" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="notif-settings">
              {notifSupported && perm === "default" && (
                <div className="notif-setting-row">
                  <span>Pop-up notifications</span>
                  <button className="btn-sm btn-pl" onClick={enablePopups}>
                    Enable
                  </button>
                </div>
              )}
              {notifSupported && perm === "denied" && (
                <div className="notif-setting-row">
                  <span style={{ color: "var(--soft)" }}>Pop-ups are blocked in browser settings</span>
                </div>
              )}
              <div className="notif-setting-row">
                <span>Sound (gong)</span>
                <button className="notif-switch" onClick={toggleSound} aria-pressed={soundOn}>
                  <span className={"toggle-switch sw-flat " + (soundOn ? "on" : "")}>
                    <span className="thumb" />
                  </span>
                </button>
              </div>
              {isPushSupported() && (
                <>
                  <div className="notif-setting-row">
                    <span>Push (tab closed too)</span>
                    <button className="notif-switch" disabled={pushBusy} onClick={togglePush} aria-pressed={pushEnabled}>
                      <span className={"toggle-switch sw-flat " + (pushEnabled ? "on" : "")}>
                        <span className="thumb" />
                      </span>
                    </button>
                  </div>
                  {pushError && <div className="notif-setting-error">{pushError}</div>}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
