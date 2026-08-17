export type PersonStatus = "Available" | "On vacation" | "Sick" | "Offline";

export type ExpertPool = "Global" | "EU & MEA & India" | "AUS / NZ / Sing / JP" | "US only";
export const EXPERT_POOLS: ExpertPool[] = ["Global", "EU & MEA & India", "AUS / NZ / Sing / JP", "US only"];

export type Stage = "First Deliverable" | "Second Deliverable" | "Hail Mary" | "Selling";

/**
 * The target a deliverer can request in a goal-change: the four stages plus a
 * shortcut to Archive the project. Displayed via stageLabel ("Selling"→"Admin").
 */
export type GoalChangeTarget = Stage | "Archive";
export const GOAL_CHANGE_TARGETS: GoalChangeTarget[] = [
  "First Deliverable",
  "Second Deliverable",
  "Hail Mary",
  "Selling",
  "Archive",
];

/** Project lifecycle — open (unclaimed) -> active (staffed), archived from either. Batch S removed 'idle'. */
export type ProjectStatus = "open" | "active" | "archived";

export interface Person {
  id: string;
  email: string;
  name: string;
  teamId: string | null;
  isManager: boolean;
  isOwner: boolean;
  practiceArea: string | null;
  status: PersonStatus;
  eveningCoverage: boolean;
  /** "Out to Lunch" — self-serve live toggle; while on, no new allocations and a red "Lunch" chip on the ranking. */
  outToLunch: boolean;
  /** "Invisible competition" — manager-set, team-scoped, reversible. */
  isGhost: boolean;
  lastLoginAt: string | null;
  deactivatedAt: string | null;
  /** Set by the BambooHR leave sync when it put this person Offline — lets "Who is out" mark BambooHR leave vs a manual Offline. */
  hrOfflineAt?: string | null;
  /** Which isolated BU this person belongs to (from the Okta department claim; owner-overridable). */
  businessUnit?: BusinessUnit;
}

/** Isolated business units (tenants). */
export type BusinessUnit = "consulting" | "non_consulting";
export const BUSINESS_UNIT_LABELS: Record<BusinessUnit, string> = {
  consulting: "Consulting",
  non_consulting: "Non-Consulting",
};

/** User management portal — role tiers. owner > manager > member. */
export type Role = "owner" | "manager" | "member";

/** A row in the owner-only user management portal (Person + resolved team name + derived role). */
export interface AdminUser extends Person {
  teamName: string | null;
  role: Role;
}

/** User groups → adjustable permission matrix. Owners aren't in it — they always hold every permission. */
export type PermissionRole = "manager" | "member";
export type PermissionMatrix = Record<PermissionRole, Record<string, boolean>>;

export interface Team {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  plId: string;
  client: string;
  account: string | null;
  topic: string | null;
  /** Required (bug fix) — every project card links its name to this. */
  projectLink: string;
  projectType: "Pitch" | "Due Diligence" | "Strategy";
  expertPool: ExpertPool;
  /** Big structural change — SUM across the project's angles (N/goal/calls_sold all live on angle now, not project). Reads identically to before when there's one angle. */
  callsN: number;
  goalTotal: number;
  callsSold: number;
  /** §3/§8 — computed (earliest among assignments), null if no assignments yet (open pool). Never stored. */
  earliestStage: Stage | null;
  /** §8.1 — computed per angle then OR'd: true if ANY angle hasn't had calls_sold touched today (Asia/Dubai). */
  needsCallsSoldUpdate: boolean;
  /** §8.1 (corrected) — computed per angle then OR'd, NOT from summed totals (a resolved angle could otherwise mask a genuinely lagging one). */
  chaseClient: boolean;
  status: ProjectStatus;
  /** New set-up field — groups the PL board into rows, 1-5. */
  clientEntity: number;
  /** "Archive for deliverers only" — non-null = off every deliverer's board, still active on the PL board. */
  deliveryClosedAt: string | null;
}

/** Big structural change — a project always has >=1 angle. N/goal/staffing are suggested per angle from that angle's own N; a "simple" project is just one with a single angle. */
export interface Angle {
  id: string;
  projectId: string;
  name: string;
  callsN: number;
  goalTotal: number;
  callsSold: number;
  callsSoldUpdatedAt: string;
  /** "Invisible competition" — per-angle opt-out, defaults true. Only actionable at intake time for Due Diligence/Strategy angles. */
  invisibleCompetitionEnabled: boolean;
  /** Expert pool per ANGLE (2026-07-21) — null inherits the project's pool, live. */
  expertPool: ExpertPool | null;
  /** Per-angle archive (2026-07-22) — non-null = archived (paused). */
  archivedAt: string | null;
}

export interface Assignment {
  id: string;
  projectId: string;
  angleId: string;
  angleName: string;
  delivererId: string;
  goal: number;
  delivered: number;
  customGoal: number;
  customDelivered: number;
  /** §3/§8 (domain change 8) — stage is per-deliverer, not per-project. */
  stage: Stage;
  stageEnteredAt: string;
  /** "Invisible competition" — the same own-goal/delivered fields render for a ghost as any deliverer; only excluded from angle/project roll-ups (see projStats() and the per-angle remaining-goal reduce). */
  isGhost: boolean;
}

export interface Note {
  id: string;
  projectId: string;
  authorId: string;
  authorRole: "PL" | "Delivery";
  body: string;
  isPublic: boolean;
  createdAt: string;
}

export interface GoalChangeRequest {
  id: string;
  assignmentId: string;
  requestedBy: string;
  body: string;
  /** Batch S, item 4 — the structured ask; null only on pre-Batch-S rows. */
  requestedGoal: number | null;
  /** A delivery-stage target ("First Deliverable"…"Selling") or "Archive". Pre-batch rows may hold a legacy value. */
  requestedStatus: GoalChangeTarget | string | null;
  resolved: boolean;
  outcome: "accepted" | "declined" | null;
}

/** BambooHR leave-sync settings (Settings → Integrations). `configured` reflects whether the env credentials are set; the API key is never sent. */
export interface HrIntegrationSettings {
  enabled: boolean;
  leaveTypeKeywords: string;
  lastSyncAt: string | null;
  lastSyncSummary: string | null;
  configured: boolean;
}

/** The actor's own still-open goal-change requests — drives the Delivery Poke button. */
export interface MyGoalChangeRequest {
  id: string;
  assignmentId: string;
  requestedGoal: number | null;
  requestedStatus: GoalChangeTarget | string | null;
}

export interface SundayRotaEntry {
  id: string;
  rotaDate: string;
  personId: string;
  teamId: string;
}

export interface SundaySwapRequest {
  id: string;
  rotaDate: string;
  requestedBy: string;
  note: string | null;
  resolved: boolean;
}

export interface RankedCandidate {
  personId: string;
  eligible: boolean;
  ineligibleReason?: "no_evening_coverage" | "out_to_lunch" | "first_deliverable_conflict" | "sunday_off";
  load: number;
  rawRemaining: number;
  practiceAreaMatch: boolean;
  free: boolean;
}

export interface CapacityRankRow {
  personId: string;
  practiceArea: string | null;
  load: number;
  rawRemaining: number;
  free: boolean;
  eligible: boolean;
  /** "Out to Lunch" — shown as a red "Lunch" chip instead of the generic "Off". */
  lunch: boolean;
  /** Sunday coverage — true when it's Sunday and this person isn't on today's rota (shown "Off"). */
  sundayOff: boolean;
}

/** docs/AUDIT_LOG_SPEC.md — GET /audit-log. `actor` is null for a rare system-triggered entry with no acting person. */
export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: { id: string; name: string; email: string } | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
}

/** §9 (built) — an in-app notification (also pushed live over WS, and to Web Push if opted in). */
export interface Notification {
  id: string;
  personId: string;
  type:
    | "assigned"
    | "delivery_logged"
    | "goal_change_requested"
    | "goal_change_resolved"
    | "stale_first_deliverable"
    | "open_pool"
    | "project_transferred";
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}

/** Owner-tunable coverage timings (Settings → Coverage). All values are minutes since Dubai midnight, except *AutoOff/*Snooze which are durations in minutes. */
export interface CoverageSettings {
  lunchPromptStartMin: number;
  lunchPromptEndMin: number;
  lunchAutoOffMin: number;
  lunchSnoozeMin: number;
  eveningPromptStartMin: number;
  eveningPromptEndMin: number;
  eveningResetStartMin: number;
  eveningResetEndMin: number;
  eveningSnoozeMin: number;
}

/** Client-side fallback = the seeded defaults, so prompts work before the fetch resolves. */
export const DEFAULT_COVERAGE: CoverageSettings = {
  lunchPromptStartMin: 750,
  lunchPromptEndMin: 870,
  lunchAutoOffMin: 60,
  lunchSnoozeMin: 30,
  eveningPromptStartMin: 1080,
  eveningPromptEndMin: 1320,
  eveningResetStartMin: 240,
  eveningResetEndMin: 480,
  eveningSnoozeMin: 60,
};

/** Owner-tunable Slack notification toggles (Settings → Notifications). slackConfigured reflects whether a webhook is set on the server (the URL is never sent to the client). */
export interface NotificationSettings {
  slackEnabled: boolean;
  slackBroadcastUpForGrabs: boolean;
  slackAssigned: boolean;
  slackGoalChangeRequested: boolean;
  slackGoalChangeResolved: boolean;
  slackDeliveryLogged: boolean;
  slackStaleFirstDeliverable: boolean;
  slackProjectTransferred: boolean;
  slackConfigured: boolean;
  /** Whether inbound interactivity (the "Accept from Slack" button) is wired — i.e. SLACK_SIGNING_SECRET is set. Read-only status; the secret is never sent. */
  slackInteractiveConfigured: boolean;
  /** Whether a bot token is set — enables per-person DMs. Read-only status; the token is never sent. */
  slackDmConfigured: boolean;
}
