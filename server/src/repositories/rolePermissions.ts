import { pool } from "../db";
import {
  PERMISSION_DEFAULTS,
  PERMISSION_KEYS,
  replacePermissionMatrix,
  type PermissionKey,
  type PermissionMatrix,
  type PermissionRole,
} from "../rules/permissionMatrix";

/**
 * Loads the DB's matrix into the sync store the predicates read. Unknown
 * roles/keys in the table are ignored; missing rows fall back to defaults —
 * so a half-seeded or future-versioned table can never widen access by
 * accident, only narrow or match the defaults.
 */
export async function hydratePermissionMatrix(): Promise<void> {
  const { rows } = await pool.query<{ role: string; permissionKey: string; allowed: boolean }>(
    `SELECT role, permission_key AS "permissionKey", allowed FROM role_permission`
  );
  const next: PermissionMatrix = {
    manager: { ...PERMISSION_DEFAULTS.manager },
    member: { ...PERMISSION_DEFAULTS.member },
  };
  for (const row of rows) {
    if (
      (row.role === "manager" || row.role === "member") &&
      (PERMISSION_KEYS as readonly string[]).includes(row.permissionKey)
    ) {
      next[row.role as PermissionRole][row.permissionKey as PermissionKey] = row.allowed;
    }
  }
  replacePermissionMatrix(next);
}

export async function savePermission(role: PermissionRole, key: PermissionKey, allowed: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO role_permission (role, permission_key, allowed)
     VALUES ($1, $2, $3)
     ON CONFLICT (role, permission_key) DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now()`,
    [role, key, allowed]
  );
  await hydratePermissionMatrix();
}
