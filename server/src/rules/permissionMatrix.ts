/**
 * The adjustable permission matrix (User Management → User groups).
 *
 * Predicates in permissions.ts consult this synchronous in-process store on
 * every check. The store starts as PERMISSION_DEFAULTS (identical to the
 * behavior shipped before the matrix existed) and is replaced with the DB's
 * truth by repositories/rolePermissions.ts — at boot and after every edit.
 * Sync-by-design: authorization checks stay plain function calls, and a
 * hydration failure degrades to the safe defaults rather than an outage.
 *
 * Owners are NOT part of the matrix: roleAllowed() short-circuits to true so
 * no stored state can ever strip an owner of anything.
 */

export type PermissionRole = "manager" | "member";

export const PERMISSION_KEYS = [
  "projects.edit_any",
  "projects.archive_delete",
  "projects.resolve_goal_requests",
  "people.set_status",
  "people.manage_roster",
  "people.set_ghost",
  "rota.manage",
  "audit.view",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type PermissionMatrix = Record<PermissionRole, Record<PermissionKey, boolean>>;

function allSetTo(value: boolean): Record<PermissionKey, boolean> {
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, value])) as Record<PermissionKey, boolean>;
}

/** Pre-matrix behavior: managers everything here, members nothing. */
export const PERMISSION_DEFAULTS: PermissionMatrix = {
  manager: allSetTo(true),
  member: allSetTo(false),
};

let matrix: PermissionMatrix = {
  manager: { ...PERMISSION_DEFAULTS.manager },
  member: { ...PERMISSION_DEFAULTS.member },
};

export interface RoleFlags {
  isManager?: boolean;
  isOwner?: boolean;
}

/** The one question the matrix answers: may this actor's group do `key`? */
export function roleAllowed(actor: RoleFlags, key: PermissionKey): boolean {
  if (actor.isOwner === true) return true; // owners: every permission, always
  const role: PermissionRole = actor.isManager === true ? "manager" : "member";
  return matrix[role][key] === true;
}

export function getPermissionMatrix(): PermissionMatrix {
  return matrix;
}

export function replacePermissionMatrix(next: PermissionMatrix): void {
  matrix = next;
}

/** Test helper — also handy for a clean revert if an owner mis-toggles everything. */
export function resetPermissionMatrix(): void {
  matrix = {
    manager: { ...PERMISSION_DEFAULTS.manager },
    member: { ...PERMISSION_DEFAULTS.member },
  };
}
