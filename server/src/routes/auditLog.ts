import type { FastifyPluginAsync } from "fastify";
import ExcelJS from "exceljs";
import { badRequest, forbidden } from "../errors";
import { listAuditLog, listPeopleForToggleMatrix, toggleOnDays } from "../repositories/auditLog";
import { canViewAuditLog } from "../rules/permissions";
import { dubaiMonthRange, dubaiMonthRangeForKey } from "../rules/time";
import { resolveNow } from "../lib/requestTime";

const TOGGLE_METRICS: Record<string, string> = { lunch: "out_to_lunch", evening: "evening_coverage" };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Shared data for the toggle matrix: every active person, the month's day keys, and the set of days each person turned the toggle on. */
async function gatherToggleMatrix(action: string, monthKey: string) {
  const { startIso, endIso } = dubaiMonthRangeForKey(monthKey);
  const [people, days] = await Promise.all([listPeopleForToggleMatrix(), toggleOnDays(action, startIso, endIso)]);
  const onByPerson = new Map<string, Set<string>>();
  for (const d of days) {
    if (!onByPerson.has(d.personId)) onByPerson.set(d.personId, new Set());
    onByPerson.get(d.personId)!.add(d.day);
  }
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayKeys = Array.from({ length: daysInMonth }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, "0")}`);
  return { people, dayKeys, onByPerson };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// Export pulls the whole filtered set in one go rather than paginating. Capped
// so a filter-less export of a huge trail can't stream unbounded memory.
const EXPORT_MAX = 50_000;

interface AuditLogQuery {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

/**
 * Docs/AUDIT_LOG_SPEC.md — GET /audit-log (the spec's own worked example
 * shows `GET /api/audit-log`, but this app has never used an `/api` prefix
 * anywhere else — every existing route registers directly off root, e.g.
 * `/projects`, `/people` — so this follows that existing convention instead
 * of introducing the only `/api`-prefixed route in the app).
 */
const auditLogRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: AuditLogQuery }>("/", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = request.actor!;
    // Audit trails are sensitive and span every team, not just one project or
    // one team's roster -- there's no global "admin" role in this app (§7b's
    // is_manager is otherwise always team-scoped: canSetPersonStatus etc. all
    // check actor.teamId === target.teamId). Restricting to "any manager,
    // regardless of team" is the closest existing concept to "admin" and is
    // a deliberate call, not an oversight -- worth revisiting if a narrower
    // role is ever introduced.
    // Owner is a superset of Manager. Since 2026-07-21 this is the matrix key
    // "audit.view" (owners always pass; groups per the User-groups matrix).
    if (!canViewAuditLog(actor)) throw forbidden("your group does not have audit-log access");

    const q = request.query ?? {};
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(q.limit) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(q.offset) || 0);

    const { items, total } = await listAuditLog({
      entityType: q.entityType,
      entityId: q.entityId,
      actorId: q.actorId,
      action: q.action,
      from: q.from,
      to: q.to,
      limit,
      offset,
    });
    return { items, total };
  });

  // CSV export of the current filtered view. Same access gate and same
  // filters as the list; pulls up to EXPORT_MAX rows (no pagination).
  app.get<{ Querystring: AuditLogQuery }>("/export.csv", { preHandler: [app.requireAuth] }, async (request, reply) => {
    const actor = request.actor!;
    if (!canViewAuditLog(actor)) throw forbidden("your group does not have audit-log access");

    const q = request.query ?? {};
    const { items } = await listAuditLog({
      entityType: q.entityType,
      entityId: q.entityId,
      actorId: q.actorId,
      action: q.action,
      from: q.from,
      to: q.to,
      limit: EXPORT_MAX,
      offset: 0,
    });

    const esc = (v: string | number): string => {
      const str = String(v);
      return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const jsonCell = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
    const header = ["When (UTC)", "Who", "Email", "Action", "Entity type", "Entity", "Entity id", "Old value", "New value"];
    const lines = [header.join(",")];
    for (const it of items) {
      lines.push(
        [
          new Date(it.createdAt).toISOString(),
          esc(it.actor?.name ?? ""),
          esc(it.actor?.email ?? ""),
          esc(it.action),
          esc(it.entityType),
          esc(it.entityLabel ?? ""),
          esc(it.entityId),
          esc(jsonCell(it.oldValue)),
          esc(jsonCell(it.newValue)),
        ].join(",")
      );
    }
    // UTF-8 BOM so Excel opens it cleanly.
    const csv = "﻿" + lines.join("\r\n") + "\r\n";
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="audit-log.csv"')
      .send(csv);
  });

  // Self-toggle matrix: one row per person, one column per Dubai day, "Yes" on
  // the days they turned the toggle on (lunch offline / evening coverage). Lets
  // leadership see who does it consistently and who doesn't. metric=lunch|evening.
  app.get<{ Querystring: { metric?: string; month?: string } }>("/toggles.csv", { preHandler: [app.requireAuth] }, async (request, reply) => {
    if (!canViewAuditLog(request.actor!)) throw forbidden("your group does not have audit-log access");
    const metric = request.query.metric ?? "lunch";
    const action = TOGGLE_METRICS[metric];
    if (!action) throw badRequest("metric must be lunch or evening");

    let range: { startIso: string; endIso: string; monthKey: string };
    try {
      range = request.query.month ? dubaiMonthRangeForKey(request.query.month) : dubaiMonthRange(resolveNow(request));
    } catch {
      throw badRequest("month must be YYYY-MM");
    }

    const mx = await gatherToggleMatrix(action, range.monthKey);
    const esc = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [["Individual", ...mx.dayKeys].map(esc).join(",")];
    for (const p of mx.people) {
      const on = mx.onByPerson.get(p.id) ?? new Set<string>();
      lines.push([esc(p.name), ...mx.dayKeys.map((d) => (on.has(d) ? "Yes" : "-"))].join(","));
    }
    const csv = "﻿" + lines.join("\r\n") + "\r\n";
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${metric}-toggles-${range.monthKey}.csv"`)
      .send(csv);
  });

  // Same matrix as an .xlsx, styled like the shared workbook: navy title bar,
  // blue header row, green "Yes" cells, frozen header + name column.
  app.get<{ Querystring: { metric?: string; month?: string } }>("/toggles.xlsx", { preHandler: [app.requireAuth] }, async (request, reply) => {
    if (!canViewAuditLog(request.actor!)) throw forbidden("your group does not have audit-log access");
    const metric = request.query.metric ?? "lunch";
    const action = TOGGLE_METRICS[metric];
    if (!action) throw badRequest("metric must be lunch or evening");
    let range: { startIso: string; endIso: string; monthKey: string };
    try {
      range = request.query.month ? dubaiMonthRangeForKey(request.query.month) : dubaiMonthRange(resolveNow(request));
    } catch {
      throw badRequest("month must be YYYY-MM");
    }

    const mx = await gatherToggleMatrix(action, range.monthKey);
    const [yy, mm] = range.monthKey.split("-").map(Number);
    const monthLabel = `${MONTH_NAMES[mm - 1]} ${yy}`;
    const meta =
      metric === "evening"
        ? { sheet: "Evening Coverage Toggles", title: `${monthLabel} - Daily Evening Coverage Toggles`, sub: "Mapping of team members who turned on evening coverage." }
        : { sheet: "Lunch Offline Toggles", title: `${monthLabel} - Daily Lunch Offline Toggles (12:00 to 16:00 GST)`, sub: "Mapping of team members who set themselves offline during the midday lunch window." };

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(meta.sheet, { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    const lastCol = mx.dayKeys.length + 1;
    const colLetter = (n: number) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
    const lastRef = colLetter(lastCol);

    ws.mergeCells(`A1:${lastRef}1`);
    const titleCell = ws.getCell("A1");
    titleCell.value = meta.title;
    titleCell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 13 };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F497D" } };
    ws.mergeCells(`A2:${lastRef}2`);
    const subCell = ws.getCell("A2");
    subCell.value = meta.sub;
    subCell.font = { italic: true, color: { argb: "FF808080" } };

    const headerRow = ws.getRow(4);
    headerRow.values = ["Individual", ...mx.dayKeys];
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
      cell.alignment = { horizontal: "center" };
    });
    headerRow.getCell(1).alignment = { horizontal: "left" };

    mx.people.forEach((p, i) => {
      const row = ws.getRow(5 + i);
      const on = mx.onByPerson.get(p.id) ?? new Set<string>();
      row.getCell(1).value = p.name;
      mx.dayKeys.forEach((d, j) => {
        const c = row.getCell(2 + j);
        c.alignment = { horizontal: "center" };
        if (on.has(d)) {
          c.value = "Yes";
          c.font = { bold: true, color: { argb: "FF006100" } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
        } else {
          c.value = "-";
        }
      });
    });

    ws.getColumn(1).width = 24;
    for (let c = 2; c <= lastCol; c++) ws.getColumn(c).width = 12;

    const buffer = await wb.xlsx.writeBuffer();
    reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${metric}-toggles-${range.monthKey}.xlsx"`)
      .send(Buffer.from(buffer));
  });
};

export default auditLogRoutes;
