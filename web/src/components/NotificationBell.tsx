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
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  const toggleSound = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    // Audible confirmation when switching on (also serves as a preview).
    if (next) playNotificationSound();
  };

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
      <button
        className={"eve-btn bell-btn" + (notif.unreadCount > 0 ? " has-unread" : "")}
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
      >
        {/* Bell drawn in the AlphaSights icon-pack line style (2.2 stroke,
            rounded caps, corner dot accent) — the pack itself has no bell.
            Bright red via .bell-btn's currentColor. */}
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
            <div className="notif-panel-footer">
              <span>Notification sound (gong)</span>
              <button className="btn-sm btn-ghost" onClick={toggleSound}>
                {soundOn ? "Turn off" : "Turn on"}
              </button>
            </div>
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
