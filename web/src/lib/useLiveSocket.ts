import { useEffect, useRef, useState } from "react";
import { wsUrl } from "../api/client";

export type LiveEvent =
  | { type: "project"; projectId: string }
  | { type: "capacity-ranking" }
  | { type: "people" }
  | { type: "open-pool" }
  | { type: "sunday-rota" }
  | {
      type: "notification";
      notification: {
        id: string;
        type: string;
        title: string;
        body: string;
        createdAt: string;
        entityType: string | null;
        entityId: string | null;
      };
    };

export type LiveStatus = "connecting" | "connected" | "reconnecting";

/**
 * §11 step 5 — a single reconnecting WebSocket for live updates. Every
 * message is an "invalidate" signal, never a data payload (the server
 * already scoped who gets notified) — callers don't need to branch on the
 * event type to stay correct, they can always just refetch, so `onEvent`
 * fires uniformly for every message AND on every successful (re)connect
 * (covers anything missed while disconnected — laptop sleep, wifi drop).
 *
 * Reconnects with exponential backoff (1s, 2s, 4s, ... capped at 15s).
 */
export function useLiveSocket(onEvent: (event: LiveEvent) => void): LiveStatus {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(wsUrl());

      socket.onopen = () => {
        attempt = 0;
        setStatus("connected");
        // Resync: whatever's currently on screen might be stale from
        // whatever happened while we were disconnected.
        onEventRef.current({ type: "capacity-ranking" });
      };

      socket.onmessage = (ev) => {
        try {
          onEventRef.current(JSON.parse(ev.data));
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        if (stopped) return;
        setStatus("reconnecting");
        const delay = Math.min(1000 * 2 ** attempt, 15000);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return status;
}
