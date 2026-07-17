/**
 * §5e/§7b — server-side authorization predicates. These must be enforced in
 * the API layer itself, not just by hiding buttons in the UI.
 */

export interface ProjectOwnership {
  plId: string;
}

/** §5e — the PL owns goal/custom_goal, always. A deliverer may never write to them. */
export function canEditGoal(actorId: string, project: ProjectOwnership): boolean {
  return actorId === project.plId;
}

export function canEditProjectFields(actorId: string, project: ProjectOwnership): boolean {
  return actorId === project.plId;
}

export function canSwapDeliverer(actorId: string, project: ProjectOwnership): boolean {
  return actorId === project.plId;
}

export function canChangeStage(actorId: string, project: ProjectOwnership): boolean {
  return actorId === project.plId;
}

export function canArchiveProject(actorId: string, project: ProjectOwnership): boolean {
  return actorId === project.plId;
}

export function canResolveGoalChangeRequest(actorId: string, project: ProjectOwnership): boolean {
  return actorId === project.plId;
}

export interface AssignmentOwnership {
  delivererId: string;
}

/** §5e — a deliverer may edit only their own delivered/custom_delivered, and only request goal changes. */
export function canEditAssignmentProgress(actorId: string, assignment: AssignmentOwnership): boolean {
  return actorId === assignment.delivererId;
}

export function canRequestGoalChange(actorId: string, assignment: AssignmentOwnership): boolean {
  return actorId === assignment.delivererId;
}

export interface ManagerActor {
  isManager: boolean;
  teamId: string | null;
  // Owner is a superset of Manager: an owner passes every team-scoped check
  // regardless of team. Optional so existing callers that pass a bare
  // { isManager, teamId } literal still compile (treated as non-owner).
  isOwner?: boolean;
}

export interface TeamScoped {
  teamId: string | null;
}

/** An owner may do anything; a manager only within their own team. */
function ownerOrSameTeam(actor: ManagerActor, target: TeamScoped): boolean {
  if (actor.isOwner) return true;
  return actor.isManager && actor.teamId === target.teamId;
}

/** §7b — a manager may set status only for members of their own team; an owner, anyone. */
export function canSetPersonStatus(actor: ManagerActor, target: TeamScoped): boolean {
  return ownerOrSameTeam(actor, target);
}

/** §7b — a manager may add/remove members only on their own team; an owner, any team. */
export function canManageTeamRoster(actor: ManagerActor, team: TeamScoped): boolean {
  return ownerOrSameTeam(actor, team);
}

/** §4 Rule 2 / §7b — a manager (or owner) may edit the relevant team's Sunday rota. */
export function canEditSundayRota(actor: ManagerActor, team: TeamScoped): boolean {
  return ownerOrSameTeam(actor, team);
}

export function canResolveSundaySwap(actor: ManagerActor, team: TeamScoped): boolean {
  return ownerOrSameTeam(actor, team);
}

/** User management portal — owners only. */
export function canManageUsers(actor: { isOwner?: boolean }): boolean {
  return actor.isOwner === true;
}

/**
 * §4 Rule 3 / §7b — evening_coverage is self-serve only. Nobody, including a
 * manager, may set it on someone else's behalf.
 */
export function canSetEveningCoverage(actorId: string, targetId: string): boolean {
  return actorId === targetId;
}
