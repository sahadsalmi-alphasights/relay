import type { MouseEvent, ReactNode } from "react";
import { useViewport } from "../lib/useViewport";

/**
 * Mobile: bottom sheet (unchanged). Desktop: centered dialog or right-hand
 * side panel, per spec §8. Content markup (h2/.sub/.sheet-footer/etc.) is
 * shared — only the outer positioning classes change.
 */
export default function Sheet({
  children,
  onClose,
  desktopVariant = "panel",
}: {
  children: ReactNode;
  onClose: () => void;
  desktopVariant?: "panel" | "dialog";
}) {
  const { isDesktop } = useViewport();
  const variant = isDesktop ? desktopVariant : "mobile";

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div className={`scrim ${variant === "dialog" ? "scrim-dialog" : variant === "panel" ? "scrim-panel" : ""}`} onClick={onClose}>
      <div className={`sheet ${variant === "dialog" ? "sheet-dialog" : variant === "panel" ? "sheet-panel" : ""}`} onClick={stop}>
        {children}
      </div>
    </div>
  );
}
