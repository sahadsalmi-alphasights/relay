import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AuditLogEntry, AuditLogPage } from "../api/types";
import { useViewport } from "../lib/useViewport";
import { useApp } from "../state/AppContext";

const PAGE_SIZE = 50;

function relativeTime(iso: string, nowMs: number): string {
  const diffMs = nowMs - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function fmtAbsolute(iso: string): string {
  return new Date(iso).toLocaleString();
}

function fmtVal(v: unknown): string {
  if (v === undefined) return "∅";
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * A short old→new preview for whichever fields actually changed; "—" if
 * there's nothing to compare (e.g. a pure "create" with no oldValue).
 *
 * `insertAuditLog()` callers are asymmetric almost everywhere in this app:
 * `oldValue` is often a full prior-row snapshot, but `newValue` is just the
 * delta that was actually written (e.g. routes/projects.ts's own PATCH
 * passes `oldValue: project` — the whole row — against `newValue:
 * request.body`, just the patch). Diffing the FULL union of both objects'
 * keys would make every field the caller didn't touch look like it was
 * cleared to ∅. Diff only the keys newValue actually names instead (falling
 * back to oldValue's keys for an old-value-only entry, e.g. a delete).
 */
function summarizeDiff(oldValue: unknown, newValue: unknown): string {
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
  if (!isRecord(oldValue) && !isRecord(newValue)) {
    if (oldValue == null && newValue == null) return "—";
    return `${fmtVal(oldValue)} → ${fmtVal(newValue)}`;
  }
  const o = isRecord(oldValue) ? oldValue : {};
  const n = isRecord(newValue) ? newValue : {};
  const keys = Object.keys(n).length > 0 ? Object.keys(n) : Object.keys(o);
  const changed = keys.filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]));
  if (changed.length === 0) return "—";
  return changed.map((k) => `${k}: ${fmtVal(o[k])} → ${fmtVal(n[k])}`).join(", ");
}

interface Filters {
  entityType: string;
  actorId: string;
  action: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { entityType: "", actorId: "", action: "", from: "", to: "" };

function buildQuery(filters: Filters, offset: number): string {
  const params = new URLSearchParams();
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.action) params.set("action", filters.action);
  if (filters.from) params.set("from", new Date(filters.from).toISOString());
  if (filters.to) params.set("to", new Date(filters.to + "T23:59:59.999").toISOString());
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  return params.toString();
}

function DiffRow({ entry }: { entry: AuditLogEntry }) {
  return (
    <div className="audit-diff">
      <div>
        <div className="audit-diff-lbl">Old value</div>
        <pre>{entry.oldValue == null ? "—" : JSON.stringify(entry.oldValue, null, 2)}</pre>
      </div>
      <div>
        <div className="audit-diff-lbl">New value</div>
        <pre>{entry.newValue == null ? "—" : JSON.stringify(entry.newValue, null, 2)}</pre>
      </div>
    </div>
  );
}

export default function AuditLogTab({ reloadTick }: { reloadTick: number }) {
  const { people, nowMs } = useApp();
  const { isDesktop } = useViewport();
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setPage(await api.get<AuditLogPage>(`/audit-log?${buildQuery(filters, offset)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the audit log");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, offset, reloadTick]);

  const updateFilter = (patch: Partial<Filters>) => {
    setOffset(0);
    setExpanded(null);
    setFilters((f) => ({ ...f, ...patch }));
  };

  const filterBar = (
    <div className="audit-filters">
      <input
        placeholder="Entity type (e.g. project)"
        value={filters.entityType}
        onChange={(e) => updateFilter({ entityType: e.target.value })}
      />
      <select value={filters.actorId} onChange={(e) => updateFilter({ actorId: e.target.value })}>
        <option value="">All actors</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input placeholder="Action (e.g. archive)" value={filters.action} onChange={(e) => updateFilter({ action: e.target.value })} />
      <input type="date" value={filters.from} onChange={(e) => updateFilter({ from: e.target.value })} title="From" />
      <input type="date" value={filters.to} onChange={(e) => updateFilter({ to: e.target.value })} title="To" />
      {(filters.entityType || filters.actorId || filters.action || filters.from || filters.to) && (
        <button className="btn-sm btn-ghost" onClick={() => updateFilter(EMPTY_FILTERS)}>
          Clear filters
        </button>
      )}
    </div>
  );

  if (error) {
    return (
      <>
        <div className="section-lbl">Audit log</div>
        <div className="empty">{error}</div>
      </>
    );
  }

  if (!page) return <div className="empty">Loading…</div>;

  const from = page.total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, page.total);
  const pager = (
    <div className="audit-pager">
      <span>
        {from}–{to} of {page.total}
      </span>
      <button className="btn-sm btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
        ← Prev
      </button>
      <button className="btn-sm btn-ghost" disabled={to >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
        Next →
      </button>
    </div>
  );

  if (isDesktop) {
    return (
      <>
        <div className="section-lbl">
          Audit log <span className="count">{page.total}</span>
        </div>
        {filterBar}
        {page.items.length === 0 ? (
          <div className="empty">No matching audit entries.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((entry) => (
                <>
                  <tr key={entry.id} className="audit-row" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
                    <td title={fmtAbsolute(entry.createdAt)}>{relativeTime(entry.createdAt, nowMs)}</td>
                    <td>{entry.actor?.name ?? "—"}</td>
                    <td className="mono">{entry.action}</td>
                    <td className="mono">
                      {entry.entityType} · {entry.entityId.slice(0, 8)}
                    </td>
                    <td className="audit-change">{summarizeDiff(entry.oldValue, entry.newValue)}</td>
                  </tr>
                  {expanded === entry.id && (
                    <tr>
                      <td colSpan={5}>
                        <DiffRow entry={entry} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
        {pager}
      </>
    );
  }

  return (
    <>
      <div className="section-lbl">
        Audit log <span className="count">{page.total}</span>
      </div>
      {filterBar}
      {page.items.length === 0 && <div className="empty">No matching audit entries.</div>}
      {page.items.map((entry) => (
        <div key={entry.id} className="rank-row" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
          <div className="rank-body">
            <div className="rank-name">
              {entry.action} <span className="mono" style={{ fontWeight: 500, color: "var(--soft)" }}>· {entry.entityType}</span>
            </div>
            <div className="rank-sub">
              <span>{entry.actor?.name ?? "system"}</span>
              <span title={fmtAbsolute(entry.createdAt)}>{relativeTime(entry.createdAt, nowMs)}</span>
            </div>
            {expanded === entry.id && <DiffRow entry={entry} />}
          </div>
        </div>
      ))}
      {pager}
    </>
  );
}
