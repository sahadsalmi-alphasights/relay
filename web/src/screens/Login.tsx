import { useEffect, useState } from "react";
import { api, apiBaseUrl, ApiError } from "../api/client";
import type { Person } from "../api/types";
import { initials } from "../lib/format";

type DevUser = Pick<Person, "id" | "name" | "email">;

/** §7/§11 step 6 — which login UI to render is a server fact (DEV_AUTH on/off), not a build-time flag, so it's fetched rather than baked into the bundle. */
function useAuthMode() {
  const [mode, setMode] = useState<{ devAuth: boolean } | null>(null);
  useEffect(() => {
    api
      .get<{ devAuth: boolean }>("/auth/mode")
      .then(setMode)
      // If the API is unreachable we still have to render *something* — default to
      // the production (SSO) screen rather than exposing the dev picker by accident.
      .catch(() => setMode({ devAuth: false }));
  }, []);
  return mode;
}

function ssoErrorFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("ssoError");
}

function SsoLogin() {
  const [error] = useState(ssoErrorFromUrl());

  // Behind the Cloudflare Access gate the user has already authenticated with
  // Okta, so the app's own login is a redundant click — go straight to the
  // OIDC flow, which returns silently via the existing Okta session. The
  // button is only shown if a prior attempt errored, to avoid a redirect loop.
  useEffect(() => {
    if (!error) window.location.href = `${apiBaseUrl}/auth/oidc/login`;
  }, [error]);

  if (!error) {
    return (
      <div className="center-screen">
        <div className="login-card">
          <h1>CapTracker</h1>
          <div className="sub">Signing you in…</div>
        </div>
      </div>
    );
  }

  // A deactivated account is bounced back here (?ssoError=disabled) with no
  // session — do NOT offer a one-click retry, since it would loop straight
  // back through Okta (still a live session) to the same rejection.
  const deactivated = error === "disabled";
  return (
    <div className="center-screen">
      <div className="login-card">
        <h1>CapTracker</h1>
        <div className="sub">Sign in with your company account.</div>
        <div className="err-line">
          {deactivated
            ? "Your account has been deactivated. Contact an owner if you think this is a mistake."
            : "Sign-in didn't complete. Please try again, or contact IT if it keeps happening."}
        </div>
        {!deactivated && (
          <button
            className="btn btn-pl"
            style={{ width: "100%", marginTop: 4 }}
            onClick={() => {
              window.location.href = `${apiBaseUrl}/auth/oidc/login`;
            }}
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function DevAuthLogin({ onLoggedIn }: { onLoggedIn: (person: Person) => void }) {
  const [users, setUsers] = useState<DevUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingInAs, setLoggingInAs] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DevUser[]>("/auth/dev-users")
      .then(setUsers)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not reach the API"));
  }, []);

  const login = async (id: string) => {
    setLoggingInAs(id);
    setError(null);
    try {
      const person = await api.post<Person>("/auth/dev-login", { personId: id });
      onLoggedIn(person);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
      setLoggingInAs(null);
    }
  };

  return (
    <div className="center-screen">
      <div className="login-card">
        <h1>CapTracker</h1>
        <div className="sub">DEV_AUTH — pick a seeded person to log in as. Production uses real SSO.</div>
        {error && <div className="err-line">{error}</div>}
        {!users && !error && <div className="empty">Loading seeded users…</div>}
        <div className="login-list">
          {users?.map((u) => (
            <button key={u.id} disabled={loggingInAs !== null} onClick={() => login(u.id)}>
              <div className="avatar">{initials(u.name)}</div>
              <div>
                <div className="lname">{u.name}</div>
                <div className="lmail">{u.email}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Login({ onLoggedIn }: { onLoggedIn: (person: Person) => void }) {
  const mode = useAuthMode();

  if (!mode) return <div className="center-screen">Loading CapTracker…</div>;
  if (!mode.devAuth) return <SsoLogin />;
  return <DevAuthLogin onLoggedIn={onLoggedIn} />;
}
