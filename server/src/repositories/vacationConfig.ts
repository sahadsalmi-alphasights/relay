import { pool } from "../db";

export interface Closure {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}
export interface BusyPeriod {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}
export interface PublicHoliday {
  id: string;
  name: string;
  holidayDate: string;
  teamId: string | null;
  reqTotal: number;
  reqSenior: number;
  reqMid: number;
  reqJunior: number;
  /** person ids assigned to cover it */
  coverage: string[];
}

// ---- company closures -------------------------------------------------------
export async function listClosures(): Promise<Closure[]> {
  const { rows } = await pool.query(
    `SELECT id, name, to_char(start_date,'YYYY-MM-DD') AS "startDate", to_char(end_date,'YYYY-MM-DD') AS "endDate"
     FROM company_closure ORDER BY start_date`
  );
  return rows;
}
export async function createClosure(name: string, startDate: string, endDate: string): Promise<Closure> {
  const { rows } = await pool.query(
    `INSERT INTO company_closure (name, start_date, end_date) VALUES ($1,$2,$3)
     RETURNING id, name, to_char(start_date,'YYYY-MM-DD') AS "startDate", to_char(end_date,'YYYY-MM-DD') AS "endDate"`,
    [name, startDate, endDate]
  );
  return rows[0];
}
export async function deleteClosure(id: string): Promise<void> {
  await pool.query(`DELETE FROM company_closure WHERE id = $1`, [id]);
}

// ---- busy periods -----------------------------------------------------------
export async function listBusyPeriods(): Promise<BusyPeriod[]> {
  const { rows } = await pool.query(
    `SELECT id, label, to_char(start_date,'YYYY-MM-DD') AS "startDate", to_char(end_date,'YYYY-MM-DD') AS "endDate"
     FROM busy_period ORDER BY start_date`
  );
  return rows;
}
export async function createBusyPeriod(label: string, startDate: string, endDate: string): Promise<BusyPeriod> {
  const { rows } = await pool.query(
    `INSERT INTO busy_period (label, start_date, end_date) VALUES ($1,$2,$3)
     RETURNING id, label, to_char(start_date,'YYYY-MM-DD') AS "startDate", to_char(end_date,'YYYY-MM-DD') AS "endDate"`,
    [label, startDate, endDate]
  );
  return rows[0];
}
export async function deleteBusyPeriod(id: string): Promise<void> {
  await pool.query(`DELETE FROM busy_period WHERE id = $1`, [id]);
}

// ---- public holidays + coverage --------------------------------------------
export async function listPublicHolidays(): Promise<PublicHoliday[]> {
  const { rows } = await pool.query(
    `SELECT h.id, h.name, to_char(h.holiday_date,'YYYY-MM-DD') AS "holidayDate", h.team_id AS "teamId",
            h.req_total AS "reqTotal", h.req_senior AS "reqSenior", h.req_mid AS "reqMid", h.req_junior AS "reqJunior",
            COALESCE(array_agg(c.person_id) FILTER (WHERE c.person_id IS NOT NULL), '{}') AS coverage
     FROM public_holiday h
     LEFT JOIN public_holiday_coverage c ON c.holiday_id = h.id
     GROUP BY h.id ORDER BY h.holiday_date`
  );
  return rows;
}

export interface HolidayInput {
  name: string;
  holidayDate: string;
  teamId: string | null;
  reqTotal: number;
  reqSenior: number;
  reqMid: number;
  reqJunior: number;
}
export async function createPublicHoliday(h: HolidayInput): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO public_holiday (name, holiday_date, team_id, req_total, req_senior, req_mid, req_junior)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [h.name, h.holidayDate, h.teamId, h.reqTotal, h.reqSenior, h.reqMid, h.reqJunior]
  );
  return rows[0].id;
}
export async function updateHolidayRequirement(
  id: string,
  req: { reqTotal: number; reqSenior: number; reqMid: number; reqJunior: number }
): Promise<void> {
  await pool.query(
    `UPDATE public_holiday SET req_total=$2, req_senior=$3, req_mid=$4, req_junior=$5 WHERE id=$1`,
    [id, req.reqTotal, req.reqSenior, req.reqMid, req.reqJunior]
  );
}
export async function deletePublicHoliday(id: string): Promise<void> {
  await pool.query(`DELETE FROM public_holiday WHERE id = $1`, [id]);
}
export async function findPublicHoliday(id: string): Promise<{ id: string } | null> {
  const { rows } = await pool.query(`SELECT id FROM public_holiday WHERE id = $1`, [id]);
  return rows[0] ?? null;
}
export async function setHolidayCoverage(holidayId: string, personId: string, assigned: boolean): Promise<void> {
  if (assigned) {
    await pool.query(
      `INSERT INTO public_holiday_coverage (holiday_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [holidayId, personId]
    );
  } else {
    await pool.query(`DELETE FROM public_holiday_coverage WHERE holiday_id=$1 AND person_id=$2`, [holidayId, personId]);
  }
}
