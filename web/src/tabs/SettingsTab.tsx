import { useState } from "react";
import CoverageSettings from "../components/CoverageSettings";
import NotificationSettings from "../components/NotificationSettings";
import SundayRotaPlanner from "../components/SundayRotaPlanner";
import UserManagementTab from "./UserManagementTab";

type SettingsView = "coverage" | "notifications" | "rota" | "users";

/**
 * Settings — the former "User Management" tab, now a container with sections:
 * Coverage settings, Notifications, Sunday rota (quarter planner), and User
 * management (the existing portal, unchanged). Owner-gated in the nav; each
 * section also enforces its own permissions server-side.
 */
export default function SettingsTab({ reloadTick, onReload }: { reloadTick: number; onReload: () => void }) {
  const [view, setView] = useState<SettingsView>("coverage");
  const tab = (v: SettingsView, label: string) => (
    <button className={"btn-sm " + (view === v ? "btn-pl" : "btn-ghost")} onClick={() => setView(v)}>
      {label}
    </button>
  );

  return (
    <>
      <div className="section-lbl" style={{ marginBottom: 4 }}>Settings</div>
      <div className="dl-view-switch settings-subnav" role="group" aria-label="Settings section">
        {tab("coverage", "Coverage settings")}
        {tab("notifications", "Notifications")}
        {tab("rota", "Sunday rota")}
        {tab("users", "User management")}
      </div>

      {view === "coverage" && <CoverageSettings onSaved={onReload} />}
      {view === "notifications" && <NotificationSettings onSaved={onReload} />}
      {view === "rota" && <SundayRotaPlanner reloadTick={reloadTick} />}
      {view === "users" && <UserManagementTab reloadTick={reloadTick} />}
    </>
  );
}
