/**
 * §5e/§7b — server-side authorization predicates. These must be enforced in
 * the API layer itself, not just by hiding buttons in the UI.
 *
 * Since the User-groups matrix (2026-07-21), what each GROUP may do comes
 * from permissionMatrix.ts (owner-editable, DB-backed, defaults = the
 * behavior shipped before). What stays hardcoded here, deliberately:
 *   - the PL always controls their own project (ownership, not a group grant)
 *   - a deliverer alone writes their own progress
 *   - owners pass every check (roleAllowed short-circuits)
 *   - team scoping: non-owners exercise people-permissions only on their own team
 *   - user management is owner-only; evening coverage is self-serve only
 */

import { roleAllowed, type PermissionKey, type RoleFlags } from "./permissionMatrix";

export interface ProjectOwnership {
  plId: string;
}

export interface ProjectActor extends RoleFlags {
  id: string;
}

function plOrGranted(actor: ProjectActor, project: ProjectOwnership, key: PermissionKey): boolean {
  return actor.id === project.plId || roleAllowed(actor, key);
}

/** §5e — the PL owns goal/custom_goal; groups granted "projects.edit_any" may too. */
export function canEditGoal(actor: ProjectActor, project: ProjectOwnership): boolean {
  return plOrGranted(actor, project, "projects.edit_any");
}

export function canEditProjectFields(actor: ProjectActor, project: ProjectOwnership): boolean {
  return plOrGranted(actor, project, "projects.edit_any");
}

export function canSwapDeliverer(actor: ProjectActor, project: ProjectOwnership): boolean {
  return plOrGranted(actor, project, "projects.edit_any");
}

export function canChangeStage(actor: ProjectActor, project: ProjectOwnership): boolean {
  return plOrGranted(actor, project, "projects.edit_any");
}

export function canArchiveProject(actor: ProjectActor, project: ProjectOwnership): boolean {
  return plOrGranted(actor, project, "projects.archive_delete");
}

export function canResolveGoalChangeRequest(actor: ProjectActor, project: ProjectOwnership): boolean {
  return plOrGranted(actor, project, "projects.resolve_goal_requests");
}

export interface AssignmentOwnership {
  delivererId: string;
}

/** §5e — a deliverer may edit only their own delivered/custom_delivered, and only request goal changes. Not matrix-adjustable. */
export function canEditAssignmentProgress(actorId: string, assignment: AssignmentOwnership): boolean {
  return actorId === assignment.delivererId;
}

export function canRequestGoalChange(actorId: string, assignment: AssignmentOwnership): boolean {
  return actorId === assignment.delivererId;
}

export interface ManagerActor extends RoleFlags {
  isManager: boolean;
  teamId: string | null;
}

export interface TeamScoped {
  teamId: string | null;
}

/**
 * People-permissions are team-scoped for everyone except owners: a granted
 * group acts only on its own team; an owner, on anyone.
 */
function grantedOnOwnTeam(actor: ManagerActor, target: TeamScoped, key: PermissionKey): boolean {
  if (actor.isOwner === true) return true;
  return roleAllowed(actor, key) && actor.teamId != null && actor.teamId === target.teamId;
}

/** §7b — status changes: own team when granted; owners, anyone. */
export function canSetPersonStatus(actor: ManagerActor, target: TeamScoped): boolean {
  return grantedOnOwnTeam(actor, target, "people.set_status");
}

/** §7b — roster add/remove: own team when granted; owners, any team. */
export function canManageTeamRoster(actor: ManagerActor, team: TeamScoped): boolean {
  return grantedOnOwnTeam(actor, team, "people.manage_roster");
}

/** Ghost flag — its own matrix row since 2026-07-21 (was folded into roster). */
export function canSetGhostFlag(actor: ManagerActor, target: TeamScoped): boolean {
  return grantedOnOwnTeam(actor, target, "people.set_ghost");
}

/** §4 Rule 2 / §7b — Sunday rota editing and swap resolution. */
export function canEditSundayRota(actor: ManagerActor, team: TeamScoped): boolean {
  return grantedOnOwnTeam(actor, team, "rota.manage");
}

export function canResolveSundaySwap(actor: ManagerActor, team: TeamScoped): boolean {
  return grantedOnOwnTeam(actor, team, "rota.manage");
}

/** Audit log — matrix-adjustable per group; owners always. */
export function canViewAuditLog(actor: RoleFlags): boolean {
  return roleAllowed(actor, "audit.view");
}

/** User management portal — owners only, never matrix-adjustable (lockout safety). */
export function canManageUsers(actor: { isOwner?: boolean }): boolean {
  return actor.isOwner === true;
}

/**
 * §4 Rule 3 / §7b — evening_coverage is self-serve only. Nobody, including a
 * manager or owner, may set it on someone else's behalf. Not in the matrix.
 */
export function canSetEveningCoverage(actorId: string, targetId: string): boolean {
  return actorId === targetId;
}
