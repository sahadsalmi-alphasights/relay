export type PersonStatus = "Available" | "On vacation" | "Sick" | "Offline";

export type ExpertPool = "Global" | "EU & MEA & India" | "AUS / NZ / Sing / JP" | "US only";

export type Stage = "First Deliverable" | "Second Deliverable" | "Hail Mary" | "Selling";

export type ProjectStatus = "matched" | "open";

export interface Person {
  id: string;
  email: string;
  name: string;
  teamId: string | null;
  isManager: boolean;
  practiceArea: string | null;
  status: PersonStatus;
  eveningCoverage: boolean;
}

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
  archived: boolean;
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
  resolved: boolean;
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
  ineligibleReason?: "not_on_sunday_rota" | "no_evening_coverage";
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

/** §9 (built) — an in-app notification (also pushed live over WS, and to Web Push if opted in). */
export interface Notification {
  id: string;
  personId: string;
  type: "assigned" | "goal_change_requested" | "goal_change_resolved" | "stale_first_deliverable" | "open_pool";
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}
