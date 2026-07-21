/**
 * My-view manual card ordering (PL + Delivery boards): the person drags
 * cards into whatever order suits them; the order lives in localStorage
 * per person per board (a personal preference, not shared state — same
 * pattern as the theme and sound toggles).
 */

export function loadCardOrder(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveCardOrder(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // storage full/blocked — ordering simply won't persist
  }
}

/**
 * Sorts `list` by the saved order; anything not in the saved order keeps its
 * automatic position, after the manually placed cards (stable sort).
 */
export function applyCardOrder<T>(list: T[], idOf: (t: T) => string, saved: string[]): T[] {
  if (saved.length === 0) return list;
  const pos = new Map(saved.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (pos.get(idOf(a)) ?? Number.MAX_SAFE_INTEGER) - (pos.get(idOf(b)) ?? Number.MAX_SAFE_INTEGER));
}

/** Move dragId so it sits immediately before targetId. */
export function moveBefore(ids: string[], dragId: string, targetId: string): string[] {
  const without = ids.filter((id) => id !== dragId);
  const at = without.indexOf(targetId);
  if (at === -1) return [...without, dragId];
  return [...without.slice(0, at), dragId, ...without.slice(at)];
}
