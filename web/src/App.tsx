import { useEffect, useState } from "react";
import { api } from "./api/client";
import type { Person } from "./api/types";
import Login from "./screens/Login";
import Onboarding from "./screens/Onboarding";
import Shell from "./Shell";
import { AppProvider } from "./state/AppContext";

type BootState = { status: "loading" } | { status: "anon" } | { status: "ready"; actor: Person };

export default function App() {
  const [boot, setBoot] = useState<BootState>({ status: "loading" });

  useEffect(() => {
    api
      .get<Person | null>("/auth/me")
      .then((actor) => setBoot(actor ? { status: "ready", actor } : { status: "anon" }))
      .catch(() => setBoot({ status: "anon" }));
  }, []);

  if (boot.status === "loading") {
    return <div className="center-screen">Loading Relay…</div>;
  }
  if (boot.status === "anon") {
    return <Login onLoggedIn={(actor) => setBoot({ status: "ready", actor })} />;
  }
  if (!boot.actor.teamId) {
    return <Onboarding actor={boot.actor} onOnboarded={(actor) => setBoot({ status: "ready", actor })} />;
  }
  return (
    <AppProvider initialActor={boot.actor}>
      <Shell />
    </AppProvider>
  );
}
