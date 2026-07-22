import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setDemoAsOf } from "../api/client";
import type { Person, Team } from "../api/types";
import { demoInstantMs, dubaiHour, isSunday } from "../lib/time";

interface AppContextValue {
  actor: Person;
  setActor: (p: Person) => void;
  people: Person[];
  teams: Team[];
  reloadPeople: () => Promise<void>;
  reloadTeams: () => Promise<void>;
  personById: (id: string) => Person | undefined;
  nameOf: (id: string) => string;
  practiceOf: (id: string) => string;
  teamNameOf: (teamId: string | null) => string;
  nowMs: number;
  demoHour: number | null;
  setDemoHour: (h: number | null) => void;
  effectiveHour: number;
  effectiveAfterHours: boolean;
  sunday: boolean;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export function AppProvider({
  initialActor,
  children,
}: {
  initialActor: Person;
  children: ReactNode;
}) {
  const [actor, setActor] = useState(initialActor);
  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [demoHour, setDemoHour] = useState<number | null>(null);

  const reloadPeople = useCallback(async () => {
    setPeople(await api.get<Person[]>("/people"));
  }, []);
  const reloadTeams = useCallback(async () => {
    setTeams(await api.get<Team[]>("/teams"));
  }, []);

  useEffect(() => {
    reloadPeople();
    reloadTeams();
  }, [reloadPeople, reloadTeams]);

  useEffect(() => {
    // nowMs lives in the shared context value, so every tick re-renders every
    // consumer — the whole board. Nothing displays seconds (the clock is
    // HH:MM; every elapsed chip is minute-granular), so a 1s tick meant ~30×
    // more full re-renders than the UI can even show. 30s keeps minute
    // boundaries visually crisp at a fraction of the render cost.
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Push the demo hour to the API client so every server-computed value
  // (capacity ranking, matching) previews the same instant the clock shows,
  // instead of the server silently using real wall-clock time.
  useEffect(() => {
    setDemoAsOf(demoHour == null ? null : new Date(demoInstantMs(nowMs, demoHour)).toISOString());
  }, [demoHour, nowMs]);

  const personById = useCallback((id: string) => people.find((p) => p.id === id), [people]);
  const nameOf = useCallback((id: string) => personById(id)?.name ?? id, [personById]);
  const practiceOf = useCallback((id: string) => personById(id)?.practiceArea ?? "", [personById]);
  const teamNameOf = useCallback(
    (teamId: string | null) => teams.find((t) => t.id === teamId)?.name ?? "",
    [teams]
  );

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    window.location.reload();
  }, []);

  const effectiveHour = demoHour ?? dubaiHour(nowMs);
  const effectiveAfterHours = demoHour != null ? demoHour < 8 || demoHour >= 19 : effectiveHour < 8 || effectiveHour >= 19;
  const sunday = isSunday(nowMs);

  const value = useMemo<AppContextValue>(
    () => ({
      actor,
      setActor,
      people,
      teams,
      reloadPeople,
      reloadTeams,
      personById,
      nameOf,
      practiceOf,
      teamNameOf,
      nowMs,
      demoHour,
      setDemoHour,
      effectiveHour,
      effectiveAfterHours,
      sunday,
      logout,
    }),
    [actor, people, teams, reloadPeople, reloadTeams, personById, nameOf, practiceOf, teamNameOf, nowMs, demoHour, effectiveHour, effectiveAfterHours, sunday, logout]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
