import { pool } from "../db";

/** All values in "minutes since Dubai midnight" (0–1439), except *_min durations which are minutes. */
export interface CoverageSettings {
  lunchPromptStartMin: number;
  lunchPromptEndMin: number;
  lunchAutoOffMin: number;
  lunchSnoozeMin: number;
  eveningPromptStartMin: number;
  eveningPromptEndMin: number;
  eveningResetStartMin: number;
  eveningResetEndMin: number;
  eveningSnoozeMin: number;
}

const SELECT = `
  SELECT lunch_prompt_start_min   AS "lunchPromptStartMin",
         lunch_prompt_end_min     AS "lunchPromptEndMin",
         lunch_auto_off_min       AS "lunchAutoOffMin",
         lunch_snooze_min         AS "lunchSnoozeMin",
         evening_prompt_start_min AS "eveningPromptStartMin",
         evening_prompt_end_min   AS "eveningPromptEndMin",
         evening_reset_start_min  AS "eveningResetStartMin",
         evening_reset_end_min    AS "eveningResetEndMin",
         evening_snooze_min       AS "eveningSnoozeMin"
  FROM coverage_settings WHERE id = 1`;

export async function getCoverageSettings(): Promise<CoverageSettings> {
  const { rows } = await pool.query<CoverageSettings>(SELECT);
  return rows[0];
}

/** snake_case column for each editable camelCase field — the only names a PATCH can touch (mass-assignment guard). */
const COLUMN: Record<keyof CoverageSettings, string> = {
  lunchPromptStartMin: "lunch_prompt_start_min",
  lunchPromptEndMin: "lunch_prompt_end_min",
  lunchAutoOffMin: "lunch_auto_off_min",
  lunchSnoozeMin: "lunch_snooze_min",
  eveningPromptStartMin: "evening_prompt_start_min",
  eveningPromptEndMin: "evening_prompt_end_min",
  eveningResetStartMin: "evening_reset_start_min",
  eveningResetEndMin: "evening_reset_end_min",
  eveningSnoozeMin: "evening_snooze_min",
};

export async function updateCoverageSettings(fields: Partial<CoverageSettings>): Promise<CoverageSettings> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of Object.keys(COLUMN) as (keyof CoverageSettings)[]) {
    const v = fields[key];
    if (v !== undefined) {
      vals.push(v);
      sets.push(`${COLUMN[key]} = $${vals.length}`);
    }
  }
  if (sets.length > 0) {
    await pool.query(`UPDATE coverage_settings SET ${sets.join(", ")}, updated_at = now() WHERE id = 1`, vals);
  }
  return getCoverageSettings();
}
