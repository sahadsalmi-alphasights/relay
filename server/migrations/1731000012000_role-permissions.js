/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Adjustable permission matrix (User Management → User groups).
//
// One row per (role, permission_key). Only "manager" and "member" rows exist:
// owners are hardcoded to every permission in the app layer (never stored, so
// no DB state can ever lock the owners out), and the User Management portal
// itself stays owner-only in code for the same reason.
//
// Seeded values reproduce exactly the behavior shipped before the matrix
// existed (managers: full project control + team operations; members: own
// work only), so this migration changes nothing on its own.

const KEYS = [
  "projects.edit_any",
  "projects.archive_delete",
  "projects.resolve_goal_requests",
  "people.set_status",
  "people.manage_roster",
  "people.set_ghost",
  "rota.manage",
  "audit.view",
];

exports.up = (pgm) => {
  pgm.createTable("role_permission", {
    role: { type: "text", notNull: true },
    permission_key: { type: "text", notNull: true },
    allowed: { type: "boolean", notNull: true },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("role_permission", "role_permission_pkey", {
    primaryKey: ["role", "permission_key"],
  });
  pgm.addConstraint("role_permission", "role_permission_role_check", {
    check: "role IN ('manager', 'member')",
  });

  const values = [];
  for (const key of KEYS) {
    values.push(`('manager', '${key}', true)`);
    values.push(`('member', '${key}', false)`);
  }
  pgm.sql(`INSERT INTO role_permission (role, permission_key, allowed) VALUES ${values.join(", ")}`);
};

exports.down = (pgm) => {
  pgm.dropTable("role_permission");
};
