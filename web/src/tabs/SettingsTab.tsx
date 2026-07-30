import { useState } from "react";
import CoverageSettings from "../components/CoverageSettings";
import UserManagementTab from "./UserManagementTab";

type SettingsView = "coverage" | "users";

/**
 * Settings — the former "User Management" tab, now a container with two
 * sections: Coverage settings (owner-tunable prompt timings) and User
 * management (the existing portal, unchanged). Owner-gated in the nav; each
 * section also enforces its own permissions server-side.
 */
export default function SettingsTab({ reloadTick, onReload }: { reloadTick: number; onReload: () => void }) {
  const [view, setView] = useState<SettingsView>("coverage");

  return (
    <>
      <div className="section-lbl" style={{ marginBottom: 4 }}>Settings</div>
      <div className="dl-view-switch settings-subnav" role="group" aria-label="Settings section">
        <button className={"btn-sm " + (view === "coverage" ? "btn-pl" : "btn-ghost")} onClick={() => setView("coverage")}>
          Coverage settings
        </button>
        <button className={"btn-sm " + (view === "users" ? "btn-pl" : "btn-ghost")} onClick={() => setView("users")}>
          User management
        </button>
      </div>

      {view === "coverage" ? <CoverageSettings onSaved={onReload} /> : <UserManagementTab reloadTick={reloadTick} />}
    </>
  );
}
