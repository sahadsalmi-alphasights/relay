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
  if (stage === "Selling") return { color: "var(--pl)", label: "Selling" };
  if (pct >= 66) return { color: "var(--green)", label: "On pace" };
  if (pct >= 33) return { color: "var(--amber)", label: "Watch" };
  return { color: "var(--red)", label: "Behind" };
}
