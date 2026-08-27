import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Scope } from "./Header";
import { Icon } from "./Icon";

interface MarketShare {
  month: string; // "YYYY-MM"
  callsSold: number;
  n: number;
  share: number | null; // null when n === 0
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Tier by market share, inclusive-lower edges: <33% red, 33–<50% yellow,
// 50–<75% green, >=75% gold (gold reads as top-tier; platinum looks disabled).
function tierColor(share: number): string {
  if (share < 0.33) return "var(--red)";
  if (share < 0.5) return "var(--amber)";
  if (share < 0.75) return "var(--green)";
  return "#D4AF37"; // gold
}

/**
 * Monthly market-share pulse (2026-07-29). A double bar under Project Leading:
 * the track is N (calls the clients wanted), the fill is calls sold; the bar
 * fills to sold ÷ N. Scope follows the board's own view — My (this PL), Team
 * (the viewed team), BU (everyone) — mapped to the /market-share endpoint.
 * Live: refetches on reloadTick, the same WS-driven signal the board uses, so
 * it recalculates the instant a call is sold or an N changes on any in-scope
 * card. N = 0 renders a neutral empty bar (no share to compute), never red.
 */
export default function MarketSharePulse({
  scope,
  teamView,
  reloadTick,
}: {
  scope: Scope;
  teamView: string;
  reloadTick: number;
}) {
  const [data, setData] = useState<MarketShare | null>(null);

  useEffect(() => {
    const params =
      scope === "mine"
        ? "scope=mine"
        : teamView === "all"
        ? "scope=bu"
        : `scope=team${teamView ? `&teamId=${teamView}` : ""}`;
    let alive = true;
    api
      .get<MarketShare>(`/projects/market-share?${params}`)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [scope, teamView, reloadTick]);

  if (!data) return null;
  const { callsSold, n, share } = data;
  const [year, month] = data.month.split("-");
  const monthName = MONTHS[Number(month) - 1] ?? data.month;
  const pct = share != null ? Math.round(share * 100) : null;
  const fillPct = n > 0 ? Math.min(100, (callsSold / n) * 100) : 0;
  const scopeLabel = scope === "mine" ? "you" : teamView === "all" ? "the BU" : "the team";
  const hover =
    share != null
      ? `${callsSold} sold of ${n} possible · ${pct}% share (${scopeLabel}, ${monthName} ${year})`
      : `No N yet this month — nothing to measure share against (${scopeLabel})`;

  return (
    <div className="ms-card" title={hover}>
      <div className="ms-head">
        <span className="ms-title">
          Market share — {monthName} <span className="ms-live"><Icon name="dot" /> live</span>
        </span>
        <span className="ms-share">{pct != null ? `${pct}% share` : "— share"}</span>
      </div>
      <div className={"ms-bar" + (share == null ? " ms-bar-empty" : "")}>
        {share != null && <span style={{ width: fillPct + "%", background: tierColor(share) }} />}
      </div>
      <div className="ms-foot">
        <span>
          <b>{callsSold}</b> calls sold
        </span>
        <span>
          <b>{n}</b> N (calls wanted)
        </span>
      </div>
    </div>
  );
}
