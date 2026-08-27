import type { CSSProperties } from "react";

/**
 * One outline icon set for the whole app — replaces the color emoji that used
 * to render inconsistently across macOS/Windows/Android and never picked up the
 * brand hue. Every glyph is a 24×24 stroke path drawn to one spec (1.75 stroke,
 * round joins) and inherits its color from `currentColor`, so an icon takes the
 * color of whatever it sits in (white on a .btn-pl, the chip's tint on a chip,
 * body ink inline) with no per-use styling. Meaning is 1:1 with the emoji it
 * replaced — see the names below. Decorative by default (aria-hidden); pass a
 * `title` to give it an accessible label.
 */
const PATHS = {
  // Actions
  edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/>',
  notes: '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6.5 7l1 12.5a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9L18.5 7"/><path d="M10 11v5.5M14 11v5.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  poke: '<path d="M9 11V6.2a1.5 1.5 0 0 1 3 0V10"/><path d="M12 10V5.4a1.5 1.5 0 0 1 3 0V11"/><path d="M15 11V7.6a1.5 1.5 0 0 1 3 0V15a5 5 0 0 1-5 5 5 5 0 0 1-4.2-2.3l-2.6-3.9a1.6 1.6 0 0 1 2.5-1.9L9 12.5"/>',
  swap: '<path d="M4 8h13l-3.2-3.2"/><path d="M20 16H7l3.2 3.2"/>',
  search: '<circle cx="11" cy="11" r="6.2"/><path d="M20 20l-4.4-4.4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  // Actions — goal-change request (was ↩)
  "arrow-back": '<path d="M9 7.5 4.5 12 9 16.5"/><path d="M4.5 12H15a4.5 4.5 0 0 1 0 9h-1.5"/>',
  // Status & state
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5"/><path d="M9.5 3.5h5"/><path d="M12 3.5v3"/>',
  ghost: '<path d="M5 20.5V11a7 7 0 0 1 14 0v9.5l-2.4-1.9-2.4 1.9-2.1-1.9-2.1 1.9-2.5-1.9z"/><circle cx="9.6" cy="10.5" r="1"/><circle cx="14.4" cy="10.5" r="1"/>',
  zzz: '<path d="M5 8h5l-5 6.5h5"/><path d="M13 4.5h4l-4 5h4"/>',
  bolt: '<path d="M13 3l-7.5 10.5H11l-1 7.5L18 10.5h-5.5z"/>',
  flame: '<path d="M12 3.5c1.2 3.6 4 4.8 4 8.5a4 4 0 0 1-8 0c0-1.8.9-2.9 1.8-3.8.4 1.7 1.7 1.9 1.7 1.9.6-2.6.1-4.6.5-6.6z"/>',
  hourglass: '<path d="M7 4h10M7 20h10"/><path d="M7.5 4c0 4 4.5 4.8 4.5 8s-4.5 4-4.5 8"/><path d="M16.5 4c0 4-4.5 4.8-4.5 8s4.5 4 4.5 8"/>',
  alert: '<path d="M12 4.5l8.5 15H3.5z"/><path d="M12 10v4.5"/><path d="M12 17.8h.01"/>',
  trophy: '<path d="M8 4.5h8V9a4 4 0 0 1-8 0z"/><path d="M8 6H5.2v.8A3 3 0 0 0 8.2 10M16 6h2.8v.8A3 3 0 0 1 15.8 10"/><path d="M12 13v3M9.2 20h5.6M10 20v-1a2 2 0 0 1 4 0v1"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.6 2.4 2.6 13.2 0 16M12 4c-2.6 2.4-2.6 13.2 0 16"/>',
  star: '<path d="M12 4.2l2.35 4.9 5.4.55-4.05 3.6 1.25 5.25L12 15.9l-4.9 2.6 1.25-5.25L4.3 9.65l5.4-.55z"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  // Domain & sections
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.2"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4"/>',
  bowl: '<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M3 20.2h18"/><path d="M11 4.2c0 1.8 1.6 1.8 1.6 3.6M14 5c0 1.4 1.2 1.4 1.2 2.8"/>',
  moon: '<path d="M20 14.2A8 8 0 1 1 9.8 4 6.2 6.2 0 0 0 20 14.2z"/>',
  chart: '<path d="M5 20V4"/><path d="M5 20h15"/><rect x="8" y="12" width="3" height="5.5"/><rect x="13.5" y="8" width="3" height="9.5"/>',
  phone: '<path d="M6 4.5h3l1.8 4.6-2.3 1.5a10.5 10.5 0 0 0 5 5l1.5-2.3 4.6 1.8V19a2 2 0 0 1-2 2A15 15 0 0 1 4 6.5a2 2 0 0 1 2-2z"/>',
  palm: '<path d="M12 9.5V20"/><path d="M12 9.5C10 7.2 6.8 7 4.6 8.6M12 9.5c2-2.3 5.2-2.5 7.4-.9M12 9.5C10.6 6.4 7.3 5.6 5 7M12 9.5c1.4-3.1 4.7-3.9 7-2.5"/><path d="M8 20.2h8"/>',
  thermometer: '<path d="M10 4.5a2 2 0 0 1 4 0v9.2a4 4 0 1 1-4 0z"/><circle cx="12" cy="17" r="1.8" fill="currentColor" stroke="none"/>',
  help: '<circle cx="12" cy="12" r="8"/><path d="M9.6 9.6a2.5 2.5 0 0 1 4 1.9c0 1.6-2 1.9-2 3.2"/><path d="M12 17.3h.01"/>',
  // Navigation
  "arrow-left": '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
  "arrow-up": '<path d="M12 19V5M6 11l6-6 6 6"/>',
  "arrow-down": '<path d="M12 5v14M6 13l6 6 6-6"/>',
  "chevron-down": '<path d="M6 9.5l6 6 6-6"/>',
  "chevron-right": '<path d="M9.5 6l6 6-6 6"/>',
  "chevron-left": '<path d="M14.5 6l-6 6 6 6"/>',
  external: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/>',
  "arrow-double": '<path d="M4 12h13"/><path d="M12.5 7l5 5-5 5"/>',
  // Transfer / hand-off (was ⤴) — forward-up arrow
  transfer: '<path d="M5 18v-5a4 4 0 0 1 4-4h9"/><path d="M14 5l5 4-5 4"/>',
  // Notifications (NotificationBell)
  users: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19.5a5.6 5.6 0 0 1 11 0"/><path d="M16 6.2a3 3 0 0 1 0 5.6M20.5 19.5a5.6 5.6 0 0 0-3.6-5.2"/>',
  trending: '<path d="M4 15.5l5-5 3 3 6-7"/><path d="M17.5 6.5H21v3.5"/>',
  "circle-check": '<circle cx="12" cy="12" r="8"/><path d="M8.2 12.2l2.8 2.8 4.8-5.6"/>',
  alarm: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.8"/><path d="M4.6 4.4 2.2 6.8M19.4 4.4l2.4 2.4"/>',
  megaphone: '<path d="M4 10.5v3l9.5 4V6.5z"/><path d="M13.5 8.5a4 4 0 0 1 0 7"/><path d="M6.5 14.2V17a1.8 1.8 0 0 0 3.6 0v-1"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 1.8H4.2z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  className,
  style,
  title,
}: {
  name: IconName;
  /** Square px size; inherits color from `currentColor`. */
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** When set, the icon is exposed to screen readers with this label. */
  title?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      style={{ display: "inline-block", verticalAlign: "-0.15em", flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : "") + PATHS[name] }}
    />
  );
}
