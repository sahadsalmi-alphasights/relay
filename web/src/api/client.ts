const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** §7/§11 step 6 — SSO login is a full-page redirect to the API (not a fetch), so Login.tsx needs the raw base URL, not just the `api` wrapper. */
export const apiBaseUrl = API_BASE;

/** §11 step 5 — same origin/cookie the REST client already authenticates against, just ws(s):// instead of http(s):// */
export function wsUrl(): string {
  return API_BASE.replace(/^http/, "ws") + "/ws";
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Set by AppContext whenever the dev-only demo clock is active, so every
// server-computed value (capacity ranking, matching) reflects the previewed
// hour instead of silently using real wall-clock time (bugs 1+2's root
// cause). Only ever honored server-side when DEV_AUTH is enabled.
let demoAsOfIso: string | null = null;
export function setDemoAsOf(iso: string | null): void {
  demoAsOfIso = iso;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  if (demoAsOfIso) headers["X-Demo-As-Of"] = demoAsOfIso;

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // no JSON body
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
