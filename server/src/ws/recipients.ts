import { findPersonById, listPeopleByTeam } from "../repositories/people";

/**
 * The recipient set for a project-scoped event: the given people themselves
 * (PL, current/former assignees — pass both when a swap moves someone off),
 * plus every teammate of each of them. This mirrors exactly what GET
 * /projects?scope=team already exposes (§8), so a WS "project changed" ping
 * never reaches someone who couldn't already see that project over REST.
 */
export async function projectRecipientIds(personIds: string[]): Promise<Set<string>> {
  const result = new Set<string>(personIds);
  const teamIds = new Set<string>();

  for (const id of personIds) {
    const person = await findPersonById(id);
    if (person?.teamId) teamIds.add(person.teamId);
  }
  for (const teamId of teamIds) {
    const members = await listPeopleByTeam(teamId);
    for (const m of members) result.add(m.id);
  }
  return result;
}
