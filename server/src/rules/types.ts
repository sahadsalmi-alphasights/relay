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
 * Project lifecycle — open (unclaimed) -> active (staffed) -> idle (parked,
 * PL's own call) -> active again, and archived from any of the three. See
 * RELAY_BUILD_SPEC.md for the full state diagram.
 */
export type ProjectStatus = "open" | "active" | "idle" | "archived";

export type ProjectType = "Pitch" | "Due Diligence" | "Strategy";
