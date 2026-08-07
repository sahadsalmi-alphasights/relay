import { apiBaseUrl } from "../api/client";

/**
 * Lightweight usage telemetry. `track()` buffers a UI event and flushes the
 * batch to POST /usage-events — best-effort, non-blocking, and swallowing all
 * errors (telemetry must never affect the app). Identity + time are stamped
 * server-side; only generic dimensions belong in `context` (never client names
 * or personal content — the server allowlists events and strips the rest).
 */
type Ctx = Record<string, string | number | boolean>;
interface Ev {
  event: string;
  context?: Ctx;
}

let buffer: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 5000;
const MAX_BUFFER = 20;

export function track(event: string, context?: Ctx): void {
  buffer.push({ event, context });
  if (buffer.length >= MAX_BUFFER) {
    flush();
    return;
  }
  if (timer == null) {
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, FLUSH_MS);
  }
}

export function flush(): void {
  if (buffer.length === 0) return;
  const events = buffer;
  buffer = [];
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    void fetch(`${apiBaseUrl}/usage-events`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      // keepalive lets the request survive a page navigation/close.
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore — telemetry is fire-and-forget
  }
}

// Flush any buffered events when the tab is backgrounded or closed.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
