import { useEffect, useState } from "react";
import type { NotificationsState } from "../lib/useNotifications";
import { disablePush, enablePush, getPushSubscription, isPushSupported } from "../lib/webPush";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function NotificationBell({ notif }: { notif: NotificationsState }) {
  const [open, setOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

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
      }
    } finally {
      setPushBusy(false);
    }
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
                    onClick={() => notif.markRead(n.id)}
                  >
                    <div className="notif-title">{n.title}</div>
                    <div className="notif-body">{n.body}</div>
                    <div className="notif-time">{timeAgo(n.createdAt)}</div>
                  </button>
                ))}
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
