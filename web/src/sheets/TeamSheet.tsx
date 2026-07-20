import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CapacityRankRow, Person, PersonStatus } from "../api/types";
import Sheet from "../components/Sheet";
import { initials } from "../lib/format";
import { useApp } from "../state/AppContext";

const STATUSES: PersonStatus[] = ["Available", "On vacation", "Sick", "Offline"];

function statusClass(s: PersonStatus): string {
  if (s === "Available") return "free";
  if (s === "Sick") return "off";
  if (s === "On vacation") return "vac";
  return "busy";
}

export default function TeamSheet({
  onClose,
  onOpenRota,
  reloadTick,
  onReload,
}: {
  onClose: () => void;
  onOpenRota: () => void;
  reloadTick: number;
  onReload: () => void;
}) {
  const { actor, people, reloadPeople, teamNameOf } = useApp();
  const teamId = actor.teamId!;
  const mates = people.filter((p) => p.teamId === teamId);

  const [unassigned, setUnassigned] = useState<Person[]>([]);
  const [pickedUnassigned, setPickedUnassigned] = useState("");
  const [capacity, setCapacity] = useState<Map<string, CapacityRankRow>>(new Map());
  const [warning, setWarning] = useState<{ name: string; outstanding: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (actor.isManager) {
      setUnassigned(await api.get<Person[]>("/people/unassigned"));
    }
    const rows = await api.get<CapacityRankRow[]>("/capacity-ranking");
    setCapacity(new Map(rows.map((r) => [r.personId, r])));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  const setGhost = async (personId: string, isGhost: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/people/${personId}/ghost`, { isGhost });
      await reloadPeople();
      onReload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set ghost status");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (personId: string, status: PersonStatus) => {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const res = await api.patch<{ person: Person; warning: { outstandingProfiles: number } | null }>(
        `/people/${personId}/status`,
        { status }
      );
      if (res.warning) {
        setWarning({ name: res.person.name, outstanding: res.warning.outstandingProfiles });
      }
      await reloadPeople();
      onReload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set status");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (personId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/people/${personId}/remove-from-team`);
      await reloadPeople();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove member");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!pickedUnassigned) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/people/${pickedUnassigned}/assign-team`, { teamId });
      setPickedUnassigned("");
      await reloadPeople();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add member");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose}>
      <h2>My team · {teamNameOf(teamId).replace("Team_", "")}</h2>
        <div className="sub">
          {actor.isManager
            ? "You're a manager — you can set status and the roster. Coverage is each person's own choice."
            : "View only. Managers manage the roster."}
        </div>
        {error && <div className="err-line">{error}</div>}
        {warning && (
          <div className="warn-line">
            ⚠ {warning.name} now has {warning.outstanding} profiles outstanding — reassign via the project card.
          </div>
        )}

        {mates.map((p) => {
          const held = capacity.get(p.id)?.rawRemaining;
          return (
            <div key={p.id} className="member">
              <div className="member-top">
                <div className="avatar">{initials(p.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="assignee-name">
                    {p.name}
                    {p.isManager ? " · mgr" : ""}
                  </div>
                  <div className="assignee-sub">
                    {p.practiceArea}
                    {held !== undefined ? ` · ${held} profiles outstanding` : ""}
                  </div>
                </div>
                <span className={"mini " + statusClass(p.status)}>{p.status}</span>
              </div>

              {actor.isManager && (
                <>
                  <div className="status-pick">
                    {STATUSES.map((s) => (
                      <button key={s} disabled={busy} className={p.status === s ? "sel" : ""} onClick={() => setStatus(p.id, s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                  <div className="cov-readonly">
                    <span className={"mini " + (p.eveningCoverage ? "free" : "busy")}>🌙 Evening {p.eveningCoverage ? "on" : "off"}</span>
                    <span className="cov-hint">evening is their own choice</span>
                  </div>
                  {/* "Invisible competition" — manager-only, team-scoped, reversible. A ghost is excluded from ranking/suggestion but stays manually staffable. */}
                  <div className="cov-readonly">
                    <span className={"mini " + (p.isGhost ? "busy" : "free")}>👻 Ghost {p.isGhost ? "on" : "off"}</span>
                    <button className="btn-sm btn-ghost" disabled={busy} onClick={() => setGhost(p.id, !p.isGhost)}>
                      {p.isGhost ? "Unset ghost" : "Set as ghost"}
                    </button>
                  </div>
                  {p.id !== actor.id && (
                    <button className="remove-btn" disabled={busy} onClick={() => remove(p.id)}>
                      Remove from team
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}

        {actor.isManager && (
          <button className="close" style={{ background: "var(--pl-soft)", color: "var(--pl)", marginBottom: 10 }} onClick={onOpenRota}>
            🗓 Manage Sunday rota →
          </button>
        )}
        {actor.isManager && (
          <div className="add-row">
            <select value={pickedUnassigned} onChange={(e) => setPickedUnassigned(e.target.value)}>
              <option value="">
                {unassigned.length ? "Add an unassigned person…" : "No unassigned people right now"}
              </option>
              {unassigned.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.email})
                </option>
              ))}
            </select>
            <button className="btn-sm btn-pl" disabled={!pickedUnassigned || busy} onClick={add}>
              Add
            </button>
          </div>
        )}
        {actor.isManager && (
          <p style={{ fontSize: 11, color: "var(--soft)", marginTop: 6 }}>
            People only exist once they've logged in via SSO/DEV_AUTH — you can add anyone not yet on a team, not invite by name.
          </p>
        )}

        <div className="sheet-footer">
          <button className="btn btn-pl" style={{ width: "100%" }} onClick={onClose}>
            Done
          </button>
        </div>
    </Sheet>
  );
}
