import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Notification } from "../api/types";

/** What the WS "notification" event actually carries (see server/src/ws/hub.ts) -- already scoped to this person, so personId/entityType/entityId aren't needed for display. */
export interface LiveNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface NotificationsState {
  notifications: Notification[];
  unreadCount: number;
  addLive: (n: LiveNotification) => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/** §9 (built) — the in-app notification centre's data: initial load over REST, live updates pushed in via addLive() from the shared WebSocket. */
export function useNotifications(): NotificationsState {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    api.get<{ notifications: Notification[]; unreadCount: number }>("/notifications").then((data) => {
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    });
  }, []);

  const addLive = (n: LiveNotification) => {
    // The WS payload only carries display fields (see LiveNotification); the
    // rest are never read by the UI, so a cast here is honest rather than
    // threading a parallel "displayable notification" type through the app.
    const full = { ...n, personId: "", entityType: null, entityId: null, read: false } as Notification;
    setNotifications((prev) => [full, ...prev]);
    setUnreadCount((c) => c + 1);
  };

  const markRead = async (id: string) => {
    const target = notifications.find((n) => n.id === id);
    if (target?.read) return;
    await api.patch(`/notifications/${id}/read`);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    await api.post("/notifications/read-all");
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  return { notifications, unreadCount, addLive, markRead, markAllRead };
}
