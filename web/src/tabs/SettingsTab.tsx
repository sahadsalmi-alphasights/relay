import { usePersistentState } from "../lib/persistentState";
import AnalyticsView from "../components/AnalyticsView";
import CoverageSettings from "../components/CoverageSettings";
import NotificationSettings from "../components/NotificationSettings";
import HrIntegrationSettings from "../components/HrIntegrationSettings";
import SlackIntegrationSettings from "../components/SlackIntegrationSettings";
import OktaIntegrationSettings from "../components/OktaIntegrationSettings";
import WhoIsOut from "../components/WhoIsOut";
import SundayRotaPlanner from "../components/SundayRotaPlanner";
import UserManagementTab from "./UserManagementTab";

type SettingsView = "coverage" | "notifications" | "integrations" | "whoout" | "rota" | "users" | "analytics";

/**
 * Settings — the former "User Management" tab, now a container with sections:
 * Coverage settings, Notifications, Sunday rota (quarter planner), and User
 * management (the existing portal, unchanged). Owner-gated in the nav; each
 * section also enforces its own permissions server-side.
 */
export default function SettingsTab({ reloadTick, onReload }: { reloadTick: number; onReload: () => void }) {
  const [view, setView] = usePersistentState<SettingsView>("relay.settings.view", "coverage", ["coverage", "notifications", "integrations", "whoout", "rota", "users", "analytics"]);
  const tab = (v: SettingsView, label: string) => (
    <button className={"btn-sm " + (view === v ? "btn-pl" : "btn-ghost")} onClick={() => setView(v)}>
      {label}
    </button>
  );

  return (
    <>
      <div className="hero-panel page-head">
        <div className="section-lbl">Settings</div>
        <div className="dl-view-switch settings-subnav" role="group" aria-label="Settings section" style={{ marginLeft: "auto" }}>
          {tab("coverage", "Coverage settings")}
          {tab("notifications", "Notifications")}
          {tab("integrations", "Integrations")}
          {tab("whoout", "Who is out")}
          {tab("rota", "Sunday rota")}
          {tab("users", "User management")}
          {tab("analytics", "Analytics")}
        </div>
      </div>

      {view === "coverage" && <CoverageSettings onSaved={onReload} />}
      {view === "notifications" && <NotificationSettings onSaved={onReload} />}
      {view === "integrations" && (
        <>
          <HrIntegrationSettings onSaved={onReload} />
          <SlackIntegrationSettings onSaved={onReload} />
          <OktaIntegrationSettings onSaved={onReload} />
        </>
      )}
      {view === "whoout" && <WhoIsOut />}
      {view === "rota" && <SundayRotaPlanner reloadTick={reloadTick} />}
      {view === "users" && <UserManagementTab reloadTick={reloadTick} />}
      {view === "analytics" && <AnalyticsView />}
    </>
  );
}
