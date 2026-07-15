import type { WebSocket } from "ws";

/**
 * §11 step 5 — live updates. Every message is an "invalidate" signal, never a
 * data payload: the client refetches via the same authorized REST endpoints
 * it already uses, so the WS layer never has to duplicate REST's
 * authorization logic — it only has to decide who gets NOTIFIED, which is
 * exactly what `recipientIds` narrows below (never send everyone everything).
 */
export type LiveEvent =
  | { type: "project"; projectId: string }
  | { type: "capacity-ranking" }
  | { type: "people" }
  | { type: "open-pool" }
  | { type: "sunday-rota" }
  /**
   * §9 (built) — the one event type carrying real content instead of just an
   * invalidate signal: it's already scoped to exactly one person (never a
   * team), so embedding it saves the client a round trip without leaking
   * anything wider than "your own notification."
   */
  | { type: "notification"; notification: { id: string; type: string; title: string; body: string; createdAt: string } };

interface Connection {
  socket: WebSocket;
  actorId: string;
  isAlive: boolean;
}

const connections = new Map<number, Connection>();
let nextId = 1;

export function registerConnection(socket: WebSocket, actorId: string): number {
  const id = nextId++;
  connections.set(id, { socket, actorId, isAlive: true });
  return id;
}

export function unregisterConnection(id: number): void {
  connections.delete(id);
}

export function markAlive(id: number): void {
  const conn = connections.get(id);
  if (conn) conn.isAlive = true;
}

/**
 * Publish an event. `recipientIds` narrows delivery to specific people
 * (e.g. a project's PL + assignees + their teammates); omit it only for
 * events that are already org-wide-visible via the equivalent REST endpoint
 * (capacity ranking, the people list, the open pool, the Sunday rota).
 */
export function publish(event: LiveEvent, recipientIds?: Set<string>): void {
  const payload = JSON.stringify(event);
  for (const conn of connections.values()) {
    if (recipientIds && !recipientIds.has(conn.actorId)) continue;
    if (conn.socket.readyState === conn.socket.OPEN) {
      conn.socket.send(payload);
    }
  }
}

/** Ping every connection; terminate any that didn't respond since the last sweep (dead from sleep/dropped wifi). */
export function heartbeatSweep(): void {
  for (const [id, conn] of connections) {
    if (!conn.isAlive) {
      conn.socket.terminate();
      connections.delete(id);
      continue;
    }
    conn.isAlive = false;
    conn.socket.ping();
  }
}

/** Started once per app instance; `.unref()`'d so it never keeps the process (or a test) alive on its own. */
export function startHeartbeat(intervalMs = 30_000): NodeJS.Timeout {
  const timer = setInterval(heartbeatSweep, intervalMs);
  timer.unref();
  return timer;
}
