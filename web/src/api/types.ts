export type PersonStatus = "Available" | "On vacation" | "Sick" | "Offline";

export type ExpertPool = "Global" | "EU & MEA & India" | "AUS / NZ / Sing / JP" | "US only";
export const EXPERT_POOLS: ExpertPool[] = ["Global", "EU & MEA & India", "AUS / NZ / Sing / JP", "US only"];

export type Stage = "First Deliverable" | "Second Deliverable" | "Hail Mary" | "Selling";

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
  /** "Invisible competition" — manager-set, team-scoped, reversible. */
  isGhost: boolean;
  lastLoginAt: string | null;
  deactivatedAt: string | null;
}

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
  requestedStatus: ProjectStatus | null;
  resolved: boolean;
  outcome: "accepted" | "declined" | null;
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
  ineligibleReason?: "no_evening_coverage" | "first_deliverable_conflict";
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
