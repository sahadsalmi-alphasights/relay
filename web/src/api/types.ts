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
  callsN: number;
  goalTotal: number;
  /** §3/§8 — computed (earliest among assignments), null if no assignments yet (open pool). Never stored. */
  earliestStage: Stage | null;
  callsSold: number;
  /** §8.1 — when calls_sold was last written; manual for now (see spec). */
  callsSoldUpdatedAt: string;
  /** §8.1 — computed: calls_sold hasn't been touched yet today (Asia/Dubai). */
  needsCallsSoldUpdate: boolean;
  status: ProjectStatus;
  archived: boolean;
}

export interface Assignment {
  id: string;
  projectId: string;
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
