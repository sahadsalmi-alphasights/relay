import type { FastifyPluginAsync } from "fastify";
import { badRequest, notFound } from "../errors";
import { insertAuditLog } from "../repositories/auditLog";
import { listPeopleForVacation, setSeniority } from "../repositories/people";
import { listTeams } from "../repositories/teams";
import { upcomingQuarters } from "../rules/quarters";
import { vacationsByEmail } from "../services/vacation";
import { diagnoseDirectory, diagnoseTimeOff, hrConfigured } from "../services/bamboohr";
import {
  createBusyPeriod,
  createClosure,
  createPublicHoliday,
  deleteBusyPeriod,
  deleteClosure,
  deletePublicHoliday,
  findPublicHoliday,
  listBusyPeriods,
  listClosures,
  listPublicHolidays,
  setHolidayCoverage,
  updateHolidayRequirement,
} from "../repositories/vacationConfig";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: unknown): s is string => typeof s === "string" && DATE_RE.test(s);
const SENIORITY = ["Senior", "Mid", "Junior"];
const intOf = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);

/**
 * Vacation Planner API — OWNER only for now (gated here and in the nav).
 * Personal vacations + who's-out come from BambooHR; closures, public
 * holidays, coverage and busy periods are CapTracker config, BU-scoped.
 * Every mutation is audit-logged.
 */
const vacationRoutes: FastifyPluginAsync = async (app) => {
  // One call powers all four tabs: people + their BambooHR time-off in the
  // window, plus config + computed quarters.
  app.get<{ Querystring: { from?: string; to?: string; teamId?: string } }>(
    "/data",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const actor = request.actor!;
      const today = new Date();
      const quarters = upcomingQuarters(today);
      // Default window must fully span the open/upcoming quarters (so the
      // "hasn't planned this quarter" check is accurate) and reach ~30 days
      // back so recent taken trips show. Callers can still override.
      const from = isDate(request.query.from)
        ? request.query.from
        : new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
      const to = isDate(request.query.to) ? request.query.to : quarters[quarters.length - 1].end;
      const teamId = request.query.teamId || null;

      const [people, byEmail, closures, publicHolidays, busyPeriods, teams, bambooConfigured] = await Promise.all([
        listPeopleForVacation(actor.businessUnit, teamId),
        vacationsByEmail(from, to),
        listClosures(),
        listPublicHolidays(),
        listBusyPeriods(),
        listTeams(),
        hrConfigured(),
      ]);

      const members = people.map((p) => ({
        ...p,
        vacations: byEmail.get(p.email.toLowerCase()) ?? [],
      }));

      return {
        me: { id: actor.id, email: actor.email },
        window: { from, to },
        // Whether BambooHR is connected — the UI uses this so a not-connected
        // integration reads as "no data yet" instead of flagging everyone.
        bambooConfigured,
        quarters,
        members,
        closures,
        publicHolidays,
        busyPeriods,
        teams,
      };
    }
  );

  // Owner diagnostics — a "test" per data source so a blank planner can be
  // debugged (is BambooHR reachable? is there time-off? do emails match?).
  // Read-only; surfaces the real error the normal sync path swallows.
  app.get<{ Querystring: { check?: string; from?: string; to?: string } }>(
    "/diagnostics",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const actor = request.actor!;
      const today = new Date();
      const from = isDate(request.query.from) ? request.query.from : today.toISOString().slice(0, 10);
      const to = isDate(request.query.to) ? request.query.to : new Date(today.getTime() + 200 * 86400000).toISOString().slice(0, 10);
      const check = request.query.check;

      if (check === "connection") return diagnoseDirectory();
      if (check === "timeoff") return diagnoseTimeOff(from, to);
      if (check === "matching") {
        const [byEmail, people] = await Promise.all([
          vacationsByEmail(from, to),
          listPeopleForVacation(actor.businessUnit),
        ]);
        const peopleEmails = new Set(people.map((p) => p.email.toLowerCase()));
        const matched = people.filter((p) => byEmail.has(p.email.toLowerCase()));
        // BambooHR people who have time-off but no matching CapTracker person in this BU.
        const unmatchedBamboo = [...byEmail.keys()].filter((e) => !peopleEmails.has(e));
        return {
          ok: true,
          window: { from, to },
          peopleInBu: people.length,
          bambooWithTimeOff: byEmail.size,
          matched: matched.length,
          matchedNames: matched.map((p) => p.name),
          unmatchedBambooEmails: unmatchedBamboo,
        };
      }
      throw badRequest("check must be one of connection, timeoff, matching");
    }
  );

  const audit = (actorId: string, entityType: string, entityId: string, action: string, newValue?: unknown) =>
    insertAuditLog({ entityType, entityId, actorId, action, newValue });

  // ---- closures -------------------------------------------------------------
  app.post<{ Body: { name?: string; startDate?: string; endDate?: string } }>(
    "/closures",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const { name, startDate, endDate } = request.body ?? {};
      if (!name?.trim() || !isDate(startDate) || !isDate(endDate)) throw badRequest("name, startDate, endDate required");
      if (endDate < startDate) throw badRequest("endDate must be on or after startDate");
      const c = await createClosure(name.trim(), startDate, endDate);
      await audit(request.actor!.id, "company_closure", c.id, "create", c);
      return c;
    }
  );
  app.delete<{ Params: { id: string } }>("/closures/:id", { preHandler: [app.requireOwner] }, async (request) => {
    await deleteClosure(request.params.id);
    await audit(request.actor!.id, "company_closure", request.params.id, "delete");
    return { ok: true };
  });

  // ---- busy periods ---------------------------------------------------------
  app.post<{ Body: { label?: string; startDate?: string; endDate?: string } }>(
    "/busy-periods",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const { label, startDate, endDate } = request.body ?? {};
      if (!label?.trim() || !isDate(startDate) || !isDate(endDate)) throw badRequest("label, startDate, endDate required");
      if (endDate < startDate) throw badRequest("endDate must be on or after startDate");
      const b = await createBusyPeriod(label.trim(), startDate, endDate);
      await audit(request.actor!.id, "busy_period", b.id, "create", b);
      return b;
    }
  );
  app.delete<{ Params: { id: string } }>("/busy-periods/:id", { preHandler: [app.requireOwner] }, async (request) => {
    await deleteBusyPeriod(request.params.id);
    await audit(request.actor!.id, "busy_period", request.params.id, "delete");
    return { ok: true };
  });

  // ---- public holidays + coverage ------------------------------------------
  app.post<{ Body: Record<string, unknown> }>(
    "/public-holidays",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const b = request.body ?? {};
      if (typeof b.name !== "string" || !b.name.trim() || !isDate(b.holidayDate)) {
        throw badRequest("name and holidayDate required");
      }
      const id = await createPublicHoliday({
        name: b.name.trim(),
        holidayDate: b.holidayDate,
        teamId: typeof b.teamId === "string" && b.teamId ? b.teamId : null,
        reqTotal: intOf(b.reqTotal),
        reqSenior: intOf(b.reqSenior),
        reqMid: intOf(b.reqMid),
        reqJunior: intOf(b.reqJunior),
      });
      await audit(request.actor!.id, "public_holiday", id, "create", { name: b.name });
      return { id };
    }
  );
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/public-holidays/:id",
    { preHandler: [app.requireOwner] },
    async (request) => {
      if (!(await findPublicHoliday(request.params.id))) throw notFound("unknown holiday");
      const b = request.body ?? {};
      const req = { reqTotal: intOf(b.reqTotal), reqSenior: intOf(b.reqSenior), reqMid: intOf(b.reqMid), reqJunior: intOf(b.reqJunior) };
      await updateHolidayRequirement(request.params.id, req);
      await audit(request.actor!.id, "public_holiday", request.params.id, "update", req);
      return { ok: true };
    }
  );
  app.delete<{ Params: { id: string } }>("/public-holidays/:id", { preHandler: [app.requireOwner] }, async (request) => {
    await deletePublicHoliday(request.params.id);
    await audit(request.actor!.id, "public_holiday", request.params.id, "delete");
    return { ok: true };
  });
  app.patch<{ Params: { id: string }; Body: { personId?: string; assigned?: boolean } }>(
    "/public-holidays/:id/coverage",
    { preHandler: [app.requireOwner] },
    async (request) => {
      if (!(await findPublicHoliday(request.params.id))) throw notFound("unknown holiday");
      const { personId, assigned } = request.body ?? {};
      if (!personId || typeof assigned !== "boolean") throw badRequest("personId and assigned required");
      await setHolidayCoverage(request.params.id, personId, assigned);
      await audit(request.actor!.id, "public_holiday", request.params.id, "coverage", { personId, assigned });
      return { ok: true };
    }
  );

  // ---- seniority (drives coverage requirements) -----------------------------
  app.patch<{ Params: { id: string }; Body: { seniority?: string | null } }>(
    "/people/:id/seniority",
    { preHandler: [app.requireOwner] },
    async (request) => {
      const s = request.body?.seniority ?? null;
      if (s !== null && !SENIORITY.includes(s)) throw badRequest("seniority must be Senior, Mid, Junior or null");
      await setSeniority(request.params.id, s);
      await audit(request.actor!.id, "person", request.params.id, "seniority_change", { seniority: s });
      return { ok: true };
    }
  );
};

export default vacationRoutes;
