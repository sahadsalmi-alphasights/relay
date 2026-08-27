import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Icon } from "./Icon";

interface DueRow {
  id: string;
  client: string;
}

/**
 * Top-of-page nudge (above the Sunday banner) for a PL whose projects still
 * need today's calls-sold number. Clicking it re-opens the calls-sold dialog
 * (same one the morning prompt uses) via onReopen; it disappears on its own
 * once everything's actioned — it re-fetches on reloadTick, which bumps after
 * a submit. Shown whenever a project is due (including weekends, matching the
 * old strip) — the dialog it opens handles the weekend case.
 */
export default function CallsSoldReminder({ reloadTick, onReopen }: { reloadTick: number; onReopen: () => void }) {
  const [due, setDue] = useState<DueRow[]>([]);

  useEffect(() => {
    api
      .get<{ due: DueRow[] }>("/projects/calls-sold-due")
      .then((res) => setDue(res.due))
      .catch(() => setDue([]));
  }, [reloadTick]);

  if (due.length === 0) return null;

  const names = due.map((d) => d.client).join(", ");
  return (
    <button type="button" className="calls-sold-banner" onClick={onReopen} title="Open the calls-sold update">
      <span className="csb-icon"><Icon name="phone" /></span>
      <span className="csb-text">
        <b>Update calls sold for today</b>
        <span className="csb-names">{names}</span>
      </span>
      <span className="csb-cta">
        {due.length} to update <span aria-hidden><Icon name="arrow-right" /></span>
      </span>
    </button>
  );
}
