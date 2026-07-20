import type { CSSProperties } from "react";
import type { Tab } from "./Header";

/** AlphaSights deck icon as a CSS mask (auto-coloured via currentColor). */
const ico = (file: string): CSSProperties => ({ ["--ico"]: `url(/icons/${file})` } as CSSProperties);

const ITEMS: { tab: Tab; icon: string; label: string }[] = [
  { tab: "PL", icon: "pl.png", label: "Leading" },
  { tab: "Delivery", icon: "delivery.png", label: "Delivery" },
  { tab: "Ranking", icon: "ranking.png", label: "Capacity" },
  { tab: "FirstDel", icon: "first-deliverables.png", label: "1st Del" },
];

/**
 * Mobile redesign — fixed navy bottom navigation (thumb zone): the four
 * daily destinations plus "More" (Ghost Ranking, Audit Log, User Management,
 * My Team, rota, evening coverage, profile). Desktop keeps the sidebar.
 */
export default function MobileNav({
  tab,
  setTab,
  plPendingCount,
  fdCount,
  onMore,
  moreBadge,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  plPendingCount: number;
  fdCount: number;
  onMore: () => void;
  moreBadge?: boolean;
}) {
  const badgeFor = (t: Tab): number => {
    if (t === "PL") return plPendingCount;
    if (t === "FirstDel") return fdCount;
    return 0;
  };

  return (
    <nav className="mobile-nav">
      {ITEMS.map((item) => (
        <button key={item.tab} className={tab === item.tab ? "active" : ""} onClick={() => setTab(item.tab)}>
          <span className="nav-ico ico" style={ico(item.icon)} aria-hidden="true" />
          <span className="lbl">{item.label}</span>
          {badgeFor(item.tab) > 0 && <span className="badge">{badgeFor(item.tab)}</span>}
        </button>
      ))}
      <button className={tab === "GhostRanking" || tab === "AuditLog" || tab === "Users" ? "active" : ""} onClick={onMore}>
        <span className="menu-ico" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="lbl">More</span>
        {moreBadge && <span className="badge">•</span>}
      </button>
    </nav>
  );
}
