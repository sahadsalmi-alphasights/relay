import { findPersonById, managersOfTeam } from "../repositories/people";
import { findTeamById } from "../repositories/teams";
import { notify } from "./notify";

interface StaffedPl {
  id: string;
  name: string;
  teamId: string | null;
}

/** The deliverer-facing copy, shared by real and ghost staffing so a ghost can never tell the two apart. */
export function staffedBody(plName: string, goal: number): string {
  return `${plName} has staffed you on a new project with a goal of ${goal}.`;
}

/**
 * Notify a newly-staffed deliverer, and — when the staffing PL is on a
 * different team — the manager(s) of the deliverer's own team, so a
 * cross-team staffing is visible to whoever runs that person's team.
 *
 * `isGhost` keeps a ghost's notification identical to a real one but skips the
 * manager fan-out (a ghost isn't a real roster commitment).
 */
export async function notifyStaffed(opts: {
  projectId: string;
  delivererId: string;
  goal: number;
  pl: StaffedPl;
  isGhost?: boolean;
}): Promise<void> {
  const { projectId, delivererId, goal, pl, isGhost } = opts;

  await notify({
    personId: delivererId,
    type: "assigned",
    title: "New project assigned to you",
    body: staffedBody(pl.name, goal),
    entityType: "project",
    entityId: projectId,
  });

  if (isGhost) return;

  const deliverer = await findPersonById(delivererId);
  if (!deliverer?.teamId || deliverer.teamId === pl.teamId) return; // same team (or no team) — no cross-team ping

  const plTeamName = pl.teamId ? (await findTeamById(pl.teamId))?.name ?? "another team" : "another team";
  const managers = await managersOfTeam(deliverer.teamId, delivererId);
  for (const m of managers) {
    await notify({
      personId: m.id,
      type: "assigned",
      title: "Team member staffed on another team's project",
      body: `${deliverer.name} has been staffed by ${pl.name} from Team ${plTeamName} with a goal of ${goal}.`,
      entityType: "project",
      entityId: projectId,
    });
  }
}
