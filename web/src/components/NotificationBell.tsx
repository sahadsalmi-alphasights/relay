import { useEffect, useState } from "react";
import type { Notification as AppNotification } from "../api/types";
import type { NotificationsState } from "../lib/useNotifications";
import { requestNotificationPermission, showBrowserNotification } from "../lib/pushNotifications";
import { disablePush, enablePush, getPushSubscription, isPushSupported } from "../lib/webPush";

const notifSupported = typeof Notification !== "undefined";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function NotificationBell({
  notif,
  onOpen,
}: {
  notif: NotificationsState;
  /** Clicking a notification navigates to the screen it's about (wired by Shell). */
  onOpen?: (n: AppNotification) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  // Foreground pop-ups need Notification permission granted — independent of
  // Web Push. Track it so we can offer a one-click "enable" instead of the
  // pop-ups silently never appearing when permission is still "default".
  const [perm, setPerm] = useState<NotificationPermission>(notifSupported ? Notification.permission : "denied");

  const enablePopups = async () => {
    const p = await requestNotificationPermission();
    setPerm(p);
    // Immediate, visible confirmation in Chrome — the browser prompt alone
    // gives no feedback that pop-ups are now actually active.
    if (p === "granted") {
      void showBrowserNotification("Notifications enabled", "You'll get CapTracker pop-ups like this one.");
    }
  };

  useEffect(() => {
    getPushSubscription().then((sub) => setPushEnabled(!!sub));
  }, []);

  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (pushEnabled) {
        await disablePush();
        setPushEnabled(false);
      } else {
        const ok = await enablePush();
        setPushEnabled(ok);
        // enablePush() requests Notification permission as part of
        // subscribing — reflect the new state and confirm visibly.
        if (notifSupported) setPerm(Notification.permission);
        if (ok) {
          void showBrowserNotification("Push notifications on", "Chrome will notify you even when the tab is closed.");
        }
      }
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
      <button className="eve-btn" onClick={() => setOpen((o) => !o)} title="Notifications">
        🔔
        {notif.unreadCount > 0 && <span className="badge bell-badge">{notif.unreadCount}</span>}
      </button>
      {open && (
        <>
          <div className="notif-scrim" onClick={() => setOpen(false)} />
          <div className="notif-panel">
            <div className="notif-panel-header">
              <b>Notifications</b>
              {notif.unreadCount > 0 && (
                <button className="link-btn" onClick={() => notif.markAllRead()}>
                  Mark all read
                </button>
              )}
            </div>
            {notif.notifications.length === 0 ? (
              <div className="empty">No notifications yet.</div>
            ) : (
              <div className="notif-list">
                {notif.notifications.map((n) => (
                  <button
                    key={n.id}
                    className={"notif-item " + (n.read ? "" : "unread")}
                    onClick={() => openNotification(n)}
                    title="Open the screen this is about"
                  >
                    <div className="notif-title">{n.title}</div>
                    <div className="notif-body">{n.body}</div>
                    <div className="notif-time">{timeAgo(n.createdAt)}</div>
                  </button>
                ))}
              </div>
            )}
            {notifSupported && perm === "default" && (
              <div className="notif-panel-footer">
                <span>Pop-up notifications</span>
                <button className="btn-sm btn-ghost" onClick={enablePopups}>
                  Enable
                </button>
              </div>
            )}
            {notifSupported && perm === "denied" && (
              <div className="notif-panel-footer">
                <span style={{ color: "var(--soft)" }}>Pop-ups are blocked in your browser settings</span>
              </div>
            )}
            {isPushSupported() && (
              <div className="notif-panel-footer">
                <span>Push notifications (tab closed too)</span>
                <button className="btn-sm btn-ghost" disabled={pushBusy} onClick={togglePush}>
                  {pushEnabled ? "Turn off" : "Turn on"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
