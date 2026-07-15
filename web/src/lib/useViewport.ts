import { useEffect, useState } from "react";

/**
 * Structural breakpoint for genuinely different DOM (sidebar vs top tab bar,
 * table vs stacked cards, dialog/panel vs bottom sheet). The 768-1023px
 * tablet gap intentionally reuses the desktop structure — CSS grid reflow
 * and a narrower sidebar handle that range, per spec §8.
 */
const DESKTOP_BREAKPOINT = 768;

export function useViewport(): { isDesktop: boolean } {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= DESKTOP_BREAKPOINT
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return { isDesktop };
}
