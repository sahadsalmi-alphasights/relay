export type PersonStatus = "Available" | "On vacation" | "Sick" | "Offline";

export type ExpertPool =
  | "Global"
  | "EU & MEA & India"
  | "AUS / NZ / Sing / JP"
  | "US only";

export type Stage =
  | "First Deliverable"
  | "Second Deliverable"
  | "Hail Mary"
  | "Selling";

/**
 * Project lifecycle — open (unclaimed) -> active (staffed), archived from
 * either. Batch S removed 'idle' (see 1731000010000_lifecycle-v2-and-goal-requests.js).
 * Soft-deleted projects (project.deleted_at) are a separate, orthogonal
 * concept — not a status value, excluded from every query instead.
 */
export type ProjectStatus = "open" | "active" | "archived";

export type ProjectType = "Pitch" | "Due Diligence" | "Strategy";
