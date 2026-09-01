import { useEffect, useState } from "react";
import { api, apiBaseUrl } from "../api/client";
import { useApp } from "../state/AppContext";
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

// The last `count` months as { key: "YYYY-MM", label: "August 2026" }, newest
// first, anchored on the month the bar is currently showing so the picker and
// the bar always agree on "this month".
function recentMonths(anchorKey: string, count: number): { key: string; label: string }[] {
  const [y, m] = anchorKey.split("-").map(Number);
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ key, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
  }
  return out;
}

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
  const { actor } = useApp();
  const [data, setData] = useState<MarketShare | null>(null);
  const [exportMonth, setExportMonth] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const params =
    scope === "mine"
      ? "scope=mine"
      : teamView === "all"
      ? "scope=bu"
      : `scope=team${teamView ? `&teamId=${teamView}` : ""}`;
  const scopeTag = scope === "mine" ? "mine" : teamView === "all" ? "bu" : "team";

  useEffect(() => {
    let alive = true;
    api
      .get<MarketShare>(`/projects/market-share?${params}`)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [params, reloadTick]);

  async function downloadCsv(monthKey: string) {
    setDownloading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/projects/market-share/export.csv?${params}&month=${monthKey}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`export failed (${res.status})`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `market-share-${monthKey}-${scopeTag}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      // Surface nothing intrusive; the button simply re-enables so it can be retried.
    } finally {
      setDownloading(false);
    }
  }

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
        {actor.isOwner && (
          <span className="ms-export" onClick={(e) => e.stopPropagation()}>
            <select
              className="ms-export-month"
              value={exportMonth ?? data.month}
              onChange={(e) => setExportMonth(e.target.value)}
              aria-label="Export month"
            >
              {recentMonths(data.month, 12).map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            <button
              className="ms-export-btn"
              disabled={downloading}
              onClick={() => downloadCsv(exportMonth ?? data.month)}
            >
              <Icon name="arrow-down" size={13} /> {downloading ? "Preparing…" : "CSV"}
            </button>
          </span>
        )}
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
