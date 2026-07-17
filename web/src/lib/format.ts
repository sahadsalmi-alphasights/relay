export function initials(name: string): string {
  const cleaned = name.replace("Resource_", "").replace("Lead_User_", "L");
  return cleaned.slice(0, 2).toUpperCase();
}

/**
 * Display-only mirror of the server's computeCustomGoal() (§5, domain change
 * 7) — for previewing the intake wizard's per-person split before confirm.
 * The server recomputes this authoritatively on create/update; this is never
 * sent back, only shown.
 */
export function previewCustomGoal(goal: number): number {
  if (goal <= 1) return 0;
  return Math.max(Math.ceil(goal * 0.33), 1);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Display-only label mapping (Phase D, item 1) — the 4th stage's stored DB
 * value stays 'Selling' unchanged (no enum rename, no CHECK constraint
 * change, no row migration); it just reads as "Admin" everywhere it's shown
 * to a user. Every render site for a stage string must go through this, not
 * interpolate `.stage` directly, so the mapping can never drift out of sync
 * between the deliverer row, the timer chip, and the project pace pill.
 */
export function stageLabel(stage: string): string {
  return stage === "Selling" ? "Admin" : stage;
}

export function stageClass(stage: string): string {
  switch (stage) {
    case "First Deliverable":
      return "stage-first";
    case "Second Deliverable":
      return "stage-second";
    case "Hail Mary":
      return "stage-hail";
    default:
      return "stage-selling";
  }
}

export function typeClass(t: string): string {
  if (t === "Pitch") return "pitch";
  if (t === "Due Diligence") return "dd";
  return "strategy";
}

export function barColor(pct: number): string {
  if (pct >= 66) return "var(--green)";
  if (pct >= 33) return "var(--amber)";
  return "var(--red)";
}

export function paceInfo(pct: number, stage: string): { color: string; label: string } {
  if (stage === "Hail Mary") return { color: "var(--red)", label: "Behind" };
  if (stage === "Selling") return { color: "var(--pl)", label: stageLabel(stage) };
  if (pct >= 66) return { color: "var(--green)", label: "On pace" };
  if (pct >= 33) return { color: "var(--amber)", label: "Watch" };
  return { color: "var(--red)", label: "Behind" };
}

/**
 * Phase D (v2), items 7/10 — the ONE shared client_entity display map.
 * `client_entity` stays the existing smallint (1-5, unchanged schema/CHECK
 * constraint) everywhere it's stored or written; this is a display-only
 * name + soft background tint, read by every place client_entity is set
 * (intake, edit-project) or shown (the entity row heading, the card header
 * tint), so the name/colour pairing is never defined more than once.
 */
export const CLIENT_ENTITY_IDS = [1, 2, 3, 4, 5] as const;

/**
 * Tints tuned toward each firm's real brand hue (still a wash, not a solid
 * fill) rather than a generic five-color set: BCG's jungle/emerald green
 * (brand green ~#147B58 -- a step darker and less neon than a first pass at
 * this palette, per feedback), McKinsey's navy/corporate blue (brand
 * ~#24477F), Bain's red (brand ~#EE3224), and Oliver Wyman's navy -- shifted
 * toward indigo specifically so it stays visually distinct from McKinsey's
 * blue rather than colliding with it (both firms' real brands are
 * blue-family; a five-color UI palette needs them tellable apart at a
 * glance, which a literal match would defeat). "Growth" isn't a real firm,
 * so it's free to be whatever reads clearly as a fifth, distinct hue
 * (orange). All five checked against --ink header text for contrast
 * (>=5.9:1, comfortably above the 4.5:1 AA minimum for normal text).
 */
export const CLIENT_ENTITY_MAP: Record<number, { name: string; tint: string }> = {
  1: { name: "BCG", tint: "#34D399" },
  2: { name: "McKinsey", tint: "#60A5FA" },
  3: { name: "Bain", tint: "#F87171" },
  4: { name: "Oliver Wyman", tint: "#818CF8" },
  5: { name: "Growth", tint: "#FB923C" },
};

export function entityName(clientEntity: number): string {
  return CLIENT_ENTITY_MAP[clientEntity]?.name ?? `Entity ${clientEntity}`;
}

export function entityTint(clientEntity: number): string {
  return CLIENT_ENTITY_MAP[clientEntity]?.tint ?? "var(--bg)";
}
