import { useEffect, useState } from "react";

/**
 * useState whose value survives a page refresh via localStorage. Used for
 * navigation state (which tab / sub-tab / section you're on) so reloading keeps
 * you on the page you were on instead of snapping back to a default.
 *
 * `valid` (optional) guards against a stale/unknown stored value — if the saved
 * string isn't in the allowed set, we fall back to `fallback`.
 */
export function usePersistentState<T extends string>(
  key: string,
  fallback: T,
  valid?: readonly T[]
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      if (saved && (!valid || valid.includes(saved))) return saved;
    } catch {
      /* storage unavailable — use the fallback */
    }
    return fallback;
  });
  useEffect(() => {
    try { localStorage.setItem(key, value); } catch { /* ignore storage errors */ }
  }, [key, value]);
  return [value, setValue];
}
