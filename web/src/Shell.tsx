import { useEffect, useState, type ReactNode } from "react";
import Header, { type Scope, type Tab } from "./components/Header";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import AuditLogTab from "./tabs/AuditLogTab";
import CapacityRankingTab from "./tabs/CapacityRankingTab";
import DeliveryTab from "./tabs/DeliveryTab";
import FirstDeliverablesTab from "./tabs/FirstDeliverablesTab";
import ProjectLeadingTab from "./tabs/ProjectLeadingTab";
import UserManagementTab from "./tabs/UserManagementTab";
import EditProjectSheet from "./sheets/EditProjectSheet";
import IntakeWizard from "./sheets/IntakeWizard";
import MorningCallsSoldDialog from "./sheets/MorningCallsSoldDialog";
import NotesSheet from "./sheets/NotesSheet";
import RotaSheet from "./sheets/RotaSheet";
import TeamEditSheet from "./sheets/TeamEditSheet";
import TeamSheet from "./sheets/TeamSheet";
import { useApp } from "./state/AppContext";
import { useViewport } from "./lib/useViewport";
import { dubaiDateKey, prettyDateKey } from "./lib/time";
import { useLiveSocket, type LiveEvent } from "./lib/useLiveSocket";
import { useNotifications } from "./lib/useNotifications";
import { showBrowserNotification } from "./lib/pushNotifications";

export interface NotesTarget {
  projectId: string;
}

export default function Shell() {
  const { sunday, nowMs, reloadPeople, reloadTeams } = useApp();
  const { isDesktop } = useViewport();
  const [tab, setTab] = useState<Tab>("PL");
  const [scope, setScope] = useState<Scope>("mine");
  const [plPendingCount, setPlPendingCount] = useState(0);
  const [fdCount, setFdCount] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);

  const [intakeOpen, setIntakeOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [rotaOpen, setRotaOpen] = useState(false);
  const [teamEditFor, setTeamEditFor] = useState<string | null>(null);
  const [editProjectFor, setEditProjectFor] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<NotesTarget | null>(null);

  const bumpReload = () => setReloadTick((t) => t + 1);
  const notif = useNotifications();

  // §11 step 5 / §9 (built) — one shared socket handles both concerns: a
  // "notification" event carries real content (already scoped server-side
  // to this person only) and feeds the bell + a browser popup; every other
  // event is a bare invalidate signal that bumps reloadTick, re-triggering
  // whichever tab is currently mounted's own authorized REST fetch.
  const handleLiveEvent = (event: LiveEvent) => {
    if (event.type === "notification") {
      notif.addLive(event.notification);
      void showBrowserNotification(event.notification.title, event.notification.body);
    } else {
      // Roster changes must refresh the directory caches (names/teams/membership
      // filters), not just the current tab's data — otherwise a renamed or newly
      // added teammate renders stale until a full reload.
      if (event.type === "people") {
        void reloadPeople();
        void reloadTeams();
      }
      bumpReload();
    }
  };
  const liveStatus = useLiveSocket(handleLiveEvent);

  // Re-fetch notifications on every (re)connect: a notification sent while this
  // client's socket was down (redeploy, wifi drop, backoff window) can't be
  // delivered live, and the reconnect resync only invalidates tab data — so
  // without this the bell silently misses it until a full page reload.
  useEffect(() => {
    if (liveStatus === "connected") void notif.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStatus]);

  const openNewProject = () => {
    setTab("PL");
    setIntakeOpen(true);
  };

  const sheets = (
    <>
      {intakeOpen && (
        <IntakeWizard
          onClose={() => setIntakeOpen(false)}
          onCreated={() => {
            setIntakeOpen(false);
            setTab("PL");
            bumpReload();
          }}
        />
      )}
      {teamEditFor && (
        <TeamEditSheet
          projectId={teamEditFor}
          onClose={() => setTeamEditFor(null)}
          onChanged={() => {
            setTeamEditFor(null);
            bumpReload();
          }}
        />
      )}
      {editProjectFor && (
        <EditProjectSheet projectId={editProjectFor} onClose={() => setEditProjectFor(null)} onChanged={bumpReload} />
      )}
      {notesFor && <NotesSheet target={notesFor} onClose={() => setNotesFor(null)} />}
      {rotaOpen && <RotaSheet onClose={() => setRotaOpen(false)} />}
      {teamOpen && (
        <TeamSheet
          onClose={() => setTeamOpen(false)}
          onOpenRota={() => {
            setTeamOpen(false);
            setRotaOpen(true);
          }}
          reloadTick={reloadTick}
          onReload={bumpReload}
        />
      )}
    </>
  );

  const sundayBanner = sunday && (
    <div className="sunday-strip">
      🗓 <b>Sunday</b> — today is {prettyDateKey(dubaiDateKey(nowMs))}.{" "}
      <button className="link-btn" onClick={() => setRotaOpen(true)}>
        View rota
      </button>
    </div>
  );

  const activeTab: ReactNode = (
    <>
      {tab === "PL" && (
        <ProjectLeadingTab
          scope={scope}
          reloadTick={reloadTick}
          onReload={bumpReload}
          onPendingCount={setPlPendingCount}
          onEditTeam={setTeamEditFor}
          onEditProject={setEditProjectFor}
          onNotes={setNotesFor}
        />
      )}
      {tab === "Delivery" && (
        <DeliveryTab scope={scope} reloadTick={reloadTick} onReload={bumpReload} onNotes={setNotesFor} />
      )}
      {tab === "Ranking" && <CapacityRankingTab reloadTick={reloadTick} />}
      {tab === "GhostRanking" && <CapacityRankingTab reloadTick={reloadTick} ghostOnly />}
      {tab === "FirstDel" && <FirstDeliverablesTab scope={scope} reloadTick={reloadTick} onCount={setFdCount} />}
      {tab === "AuditLog" && <AuditLogTab reloadTick={reloadTick} />}
      {tab === "Users" && <UserManagementTab reloadTick={reloadTick} />}
    </>
  );

  if (isDesktop) {
    return (
      <div className="app-shell">
        <MorningCallsSoldDialog onActioned={bumpReload} />
        <Sidebar
          tab={tab}
          setTab={setTab}
          scope={scope}
          setScope={setScope}
          plPendingCount={plPendingCount}
          fdCount={fdCount}
          onOpenTeam={() => setTeamOpen(true)}
          onNewProject={openNewProject}
        />
        <div className="main-area">
          <TopBar liveStatus={liveStatus} notif={notif} />
          <div className="content-wide">
            {sundayBanner}
            {activeTab}
          </div>
        </div>
        {sheets}
      </div>
    );
  }

  const modeClass =
    tab === "PL"
      ? "pl"
      : tab === "Delivery"
      ? "dl"
      : tab === "Ranking" || tab === "GhostRanking"
      ? "rk"
      : tab === "FirstDel"
      ? "fd"
      : "al";

  return (
    <div className="relay">
      <MorningCallsSoldDialog onActioned={bumpReload} />
      <Header
        tab={tab}
        setTab={setTab}
        scope={scope}
        setScope={setScope}
        plPendingCount={plPendingCount}
        fdCount={fdCount}
        onOpenTeam={() => setTeamOpen(true)}
        liveStatus={liveStatus}
        notif={notif}
      />

      <div className="body">
        <div className={"mode-strip " + modeClass} />
        {sundayBanner}
        {activeTab}
      </div>

      {tab === "PL" && (
        <button className="fab" onClick={() => setIntakeOpen(true)}>
          ＋ New project
        </button>
      )}

      {sheets}
    </div>
  );
}
