/**
 * Quarterly vacation-planning windows and their submission deadlines.
 *
 * Deadlines (from the product spec): a quarter's time off must be logged by —
 *   Q1 (Jan–Mar): Sep 30 of the PRIOR year
 *   Q2 (Apr–Jun): Jan 30 same year
 *   Q3 (Jul–Sep): Mar 30 same year
 *   Q4 (Oct–Dec): Jul 30 same year
 * Late submissions are flagged, never auto-declined. Computed, not stored.
 */
export interface QuarterWindow {
  label: string; // "Q1 2027"
  quarter: 1 | 2 | 3 | 4;
  year: number;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  deadline: string; // YYYY-MM-DD
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function quarterOf(q: 1 | 2 | 3 | 4, year: number): QuarterWindow {
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const endDay = [4, 6, 9, 11].includes(endMonth) ? 30 : endMonth === 2 ? 28 : 31;
  const deadline =
    q === 1 ? iso(year - 1, 9, 30) : q === 2 ? iso(year, 1, 30) : q === 3 ? iso(year, 3, 30) : iso(year, 7, 30);
  return { label: `Q${q} ${year}`, quarter: q, year, start: iso(year, startMonth, 1), end: iso(year, endMonth, endDay), deadline };
}

/** The quarter containing `date`, plus the next `ahead` quarters. */
export function upcomingQuarters(now: Date, ahead = 3): QuarterWindow[] {
  let q = (Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  let year = now.getFullYear();
  const out: QuarterWindow[] = [];
  for (let i = 0; i <= ahead; i++) {
    out.push(quarterOf(q, year));
    q = (q === 4 ? 1 : q + 1) as 1 | 2 | 3 | 4;
    if (q === 1) year += 1;
  }
  return out;
}
