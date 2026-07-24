import { useEffect, useRef, useState, type ReactNode } from "react";
import Header, { type Scope, type Tab } from "./components/Header";
import MobileNav from "./components/MobileNav";
import type { Notification as AppNotification } from "./api/types";
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
import MoreSheet from "./sheets/MoreSheet";
import NotesSheet from "./sheets/NotesSheet";
import RotaSheet from "./sheets/RotaSheet";
import TeamEditSheet from "./sheets/TeamEditSheet";
import TransferPlSheet from "./sheets/TransferPlSheet";
import TeamSheet from "./sheets/TeamSheet";
import { api } from "./api/client";
import type { Assignment, Project } from "./api/types";
import { useApp } from "./state/AppContext";
import { useViewport } from "./lib/useViewport";
import { dubaiDateKey, prettyDateKey } from "./lib/time";
import { useLiveSocket, type LiveEvent } from "./lib/useLiveSocket";
import { useNotifications } from "./lib/useNotifications";
import { showBrowserNotification } from "./lib/pushNotifications";
import { initSoundUnlock, playNotificationSound } from "./lib/notificationSound";

export interface NotesTarget {
  projectId: string;
}

export default function Shell() {
  const { sunday, nowMs, reloadPeople, reloadTeams } = useApp();
  const { isDesktop } = useViewport();
  const [tab, setTab] = useState<Tab>("PL");
  const [scope, setScope] = useState<Scope>("mine");
  // Team view target: "" = own team (default), "all" = whole BU, else a team id.
  const [teamView, setTeamView] = useState<string>("");
  const [plPendingCount, setPlPendingCount] = useState(0);
  const [fdCount, setFdCount] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);

  const [intakeOpen, setIntakeOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [rotaOpen, setRotaOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Deep-link target when a notification is clicked: the tab switches AND the
  // project card scrolls into view with a highlight pulse.
  const [focusProject, setFocusProject] = useState<{ id: string; tick: number } | null>(null);
  // A goal-change notification deep-links to the specific deliverer's goal +
  // stage editor, not just the project card.
  const [focusAssignment, setFocusAssignment] = useState<{ id: string; tick: number } | null>(null);
  const [teamEditFor, setTeamEditFor] = useState<string | null>(null);
  const [editProjectFor, setEditProjectFor] = useState<string | null>(null);
  // Transfer-to-another-PL: holds the full project whose card is being handed off.
  const [transferProject, setTransferProject] = useState<Project | null>(null);
  const [notesFor, setNotesFor] = useState<NotesTarget | null>(null);

  const bumpReload = () => setReloadTick((t) => t + 1);
  // Live WS events can arrive in bursts (a teammate logging several
  // deliveries, a fan-out to the whole BU). Reloading the board on each one
  // repaints every card — on a 58-card BU view that's the flickery
  // "Loading…" thrash. Coalesce a burst into a single reload ~700ms after it
  // settles. User-initiated actions still call bumpReload() directly for an
  // instant refresh; this only debounces the passive live-invalidate path.
  const liveReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpReloadDebounced = () => {
    if (liveReloadTimer.current) clearTimeout(liveReloadTimer.current);
    liveReloadTimer.current = setTimeout(() => setReloadTick((t) => t + 1), 700);
  };
  const notif = useNotifications();

  // Sound: pre-unlock the AudioContext on the first user gesture so the
  // notification gong is allowed to play later (browser autoplay policy).
  useEffect(() => {
    initSoundUnlock();
  }, []);

  // §11 step 5 / §9 (built) — one shared socket handles both concerns: a
  // "notification" event carries real content (already scoped server-side
  // to this person only) and feeds the bell + a browser popup; every other
  // event is a bare invalidate signal that bumps reloadTick, re-triggering
  // whichever tab is currently mounted's own authorized REST fetch.
  const handleLiveEvent = (event: LiveEvent) => {
    if (event.type === "notification") {
      notif.addLive(event.notification);
      playNotificationSound();
      void showBrowserNotification(event.notification.title, event.notification.body);
    } else {
      // Roster changes must refresh the directory caches (names/teams/membership
      // filters), not just the current tab's data — otherwise a renamed or newly
      // added teammate renders stale until a full reload.
      if (event.type === "people") {
        void reloadPeople();
        void reloadTeams();
      }
      bumpReloadDebounced();
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

  // Clicking a notification in the bell navigates to the screen it's about.
  // The type is the primary routing signal; two title prefixes disambiguate
  // the shared types whose PL-facing copy differs from the deliverer's.
  const openNotification = async (n: AppNotification) => {
    if (
      n.type === "delivery_logged" ||
      n.type === "goal_change_requested" ||
      n.type === "project_transferred" ||
      (n.type === "stale_first_deliverable" && n.title.startsWith("Deliverer stalled")) ||
      (n.type === "assigned" && n.title.startsWith("Seat claimed"))
    ) {
      setTab("PL");
    } else {
      setTab("Delivery");
    }
    bumpReload();
    // Resolve the concrete project so the board can scroll to and flash its
    // card — entityType tells us how many hops away the project id is.
    try {
      let projectId: string | null = null;
      if (n.entityType === "project") projectId = n.entityId;
      else if (n.entityType === "assignment" && n.entityId) {
        const a = await api.get<Assignment>(`/assignments/${n.entityId}`);
        projectId = a.projectId;
      }
      if (projectId) setFocusProject({ id: projectId, tick: Date.now() });
      // Goal-change requests deep-link to the exact assignment so its goal +
      // stage editor opens (and the row flashes), not just the card.
      if (n.type === "goal_change_requested" && n.entityType === "assignment" && n.entityId) {
        setFocusAssignment({ id: n.entityId, tick: Date.now() });
      }
    } catch {
      // fine — we still landed on the right board
    }
  };

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
      {transferProject && (
        <TransferPlSheet
          project={transferProject}
          onClose={() => setTransferProject(null)}
          onTransferred={() => {
            setTransferProject(null);
            bumpReload();
          }}
        />
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
          teamView={teamView}
          reloadTick={reloadTick}
          onReload={bumpReload}
          onPendingCount={setPlPendingCount}
          onEditTeam={setTeamEditFor}
          onEditProject={setEditProjectFor}
          onTransfer={setTransferProject}
          onNotes={setNotesFor}
          focusProject={focusProject}
          focusAssignment={focusAssignment}
        />
      )}
      {tab === "Delivery" && (
        <DeliveryTab
          scope={scope}
          teamView={teamView}
          reloadTick={reloadTick}
          onReload={bumpReload}
          onNotes={setNotesFor}
          focusProject={focusProject}
        />
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
          teamView={teamView}
          setTeamView={setTeamView}
          plPendingCount={plPendingCount}
          fdCount={fdCount}
          onOpenTeam={() => setTeamOpen(true)}
          onNewProject={openNewProject}
        />
        <div className="main-area">
          <TopBar liveStatus={liveStatus} notif={notif} onOpenNotification={openNotification} />
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
        scope={scope}
        setScope={setScope}
        teamView={teamView}
        setTeamView={setTeamView}
        onOpenTeam={() => setTeamOpen(true)}
        liveStatus={liveStatus}
        notif={notif}
        onOpenNotification={openNotification}
      />

      <div className="body">
        <div className={"mode-strip " + modeClass} />
        {sundayBanner}
        {activeTab}
      </div>

      {tab === "PL" && (
        <button className="fab" onClick={() => setIntakeOpen(true)} aria-label="New project" title="New project">
          ＋
        </button>
      )}

      <MobileNav
        tab={tab}
        setTab={setTab}
        plPendingCount={plPendingCount}
        fdCount={fdCount}
        onMore={() => setMoreOpen(true)}
      />
      {moreOpen && (
        <MoreSheet
          onClose={() => setMoreOpen(false)}
          setTab={setTab}
          onOpenTeam={() => setTeamOpen(true)}
          onOpenRota={() => setRotaOpen(true)}
        />
      )}

      {sheets}
    </div>
  );
}
