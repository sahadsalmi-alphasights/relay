import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Person, Team } from "../api/types";

/** §7a — first-login onboarding: join an existing team, or create one (creator becomes manager). */
export default function Onboarding({
  actor,
  onOnboarded,
}: {
  actor: Person;
  onOnboarded: (person: Person) => void;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [newTeamName, setNewTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Team[]>("/teams").then(setTeams).catch(() => setTeams([]));
  }, []);

  const join = async (teamId: string) => {
    setBusy(true);
    setError(null);
    try {
      onOnboarded(await api.post<Person>("/onboarding/team", { teamId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join team");
      setBusy(false);
    }
  };

  const create = async () => {
    if (!newTeamName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onOnboarded(await api.post<Person>("/onboarding/team", { newTeamName: newTeamName.trim() }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create team");
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <div className="login-card">
        <h1>Welcome, {actor.name}</h1>
        <div className="sub">Which team are you on? Pick an existing team, or start a new one.</div>
        {error && <div className="err-line">{error}</div>}
        <div className="login-list">
          {teams.map((t) => (
            <button key={t.id} disabled={busy} onClick={() => join(t.id)}>
              <div>
                <div className="lname">{t.name}</div>
                <div className="lmail">Join this team</div>
              </div>
            </button>
          ))}
        </div>
        <div className="add-row">
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="New team name, e.g. Team_Gamma"
          />
          <button className="btn-sm btn-pl" disabled={busy} onClick={create}>
            Create
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--soft)", marginTop: 10 }}>
          Creating a new team makes you its manager.
        </p>
      </div>
    </div>
  );
}
