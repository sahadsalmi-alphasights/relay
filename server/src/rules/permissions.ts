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
}

export interface TeamScoped {
  teamId: string | null;
}

/** §7b — a manager may set status only for members of their own team. */
export function canSetPersonStatus(actor: ManagerActor, target: TeamScoped): boolean {
  return actor.isManager && actor.teamId === target.teamId;
}

/** §7b — a manager may add/remove members only on their own team. */
export function canManageTeamRoster(actor: ManagerActor, team: TeamScoped): boolean {
  return actor.isManager && actor.teamId === team.teamId;
}

/** §4 Rule 2 / §7b — only a manager may edit their own team's Sunday rota. */
export function canEditSundayRota(actor: ManagerActor, team: TeamScoped): boolean {
  return actor.isManager && actor.teamId === team.teamId;
}

export function canResolveSundaySwap(actor: ManagerActor, team: TeamScoped): boolean {
  return actor.isManager && actor.teamId === team.teamId;
}

/**
 * §4 Rule 3 / §7b — evening_coverage is self-serve only. Nobody, including a
 * manager, may set it on someone else's behalf.
 */
export function canSetEveningCoverage(actorId: string, targetId: string): boolean {
  return actorId === targetId;
}
