import { insertAuditLog } from "../repositories/auditLog";
import {
  clearHrLeaveToAvailable,
  findPersonByEmail,
  listHrManagedLeave,
  setHrOnLeave,
} from "../repositories/people";
import { getHrIntegrationSettings, recordHrSync } from "../repositories/hrIntegrationSettings";
import { dubaiDateKey } from "../rules/time";
import { publish } from "../ws/hub";
import { fetchPlannedTimeOff, fetchDirectoryEmails, hrConfigured, type TimeOffRequest } from "./bamboohr";

/** Case-insensitive substring match of a BambooHR type name against the comma-separated keyword list. */
export function matchesLeaveType(typeName: string, keywords: string): boolean {
  const name = typeName.trim().toLowerCase();
  return keywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((k) => name.includes(k));
}

/**
 * The set of work emails (lower-cased) currently on a matching leave type,
 * joining time-off requests to the directory by employeeId. Pure — the unit
 * under test.
 */
export function emailsOnLeave(
  requests: TimeOffRequest[],
  directory: Map<string, string>,
  keywords: string
): Set<string> {
  const emails = new Set<string>();
  for (const r of requests) {
    if (!matchesLeaveType(r.typeName, keywords)) continue;
    const email = directory.get(r.employeeId);
    if (email) emails.add(email);
  }
  return emails;
}

export interface HrSyncResult {
  ran: boolean;
  setOnLeave: number;
  restored: number;
  summary: string;
}

/**
 * One sync pass: set every CapTracker person who's on a matching BambooHR leave
 * today to "On vacation" (marking them with hr_offline_at so we own that state),
 * and restore to Available anyone we previously set who is no longer out. No-op
 * unless the integration is both configured (env) and enabled (settings).
 * System-actor audit rows (actorId: null) record every status flip.
 */
export async function runHrLeaveSync(now: Date): Promise<HrSyncResult> {
  if (!(await hrConfigured())) return { ran: false, setOnLeave: 0, restored: 0, summary: "BambooHR not configured." };
  const settings = await getHrIntegrationSettings();
  if (!settings.enabled) return { ran: false, setOnLeave: 0, restored: 0, summary: "Sync disabled." };

  const today = dubaiDateKey(now);
  const [requests, directory] = await Promise.all([fetchPlannedTimeOff(today, today), fetchDirectoryEmails()]);
  if (requests === null || directory === null) {
    const summary = "Sync failed — could not reach BambooHR (check the API key and subdomain).";
    await recordHrSync(summary);
    return { ran: true, setOnLeave: 0, restored: 0, summary };
  }

  const onLeave = emailsOnLeave(requests, directory, settings.leaveTypeKeywords);

  // Set "On vacation" everyone currently on leave that we can match by email.
  let setOnLeave = 0;
  for (const email of onLeave) {
    const person = await findPersonByEmail(email);
    if (!person || person.deactivatedAt) continue;
    if (person.status !== "On vacation") {
      await setHrOnLeave(person.id);
      await insertAuditLog({
        entityType: "person",
        entityId: person.id,
        actorId: null, // system actor — the sync, not a user
        action: "hr_set_on_leave",
        oldValue: { status: person.status },
        newValue: { status: "On vacation", source: "bamboohr" },
      });
      setOnLeave += 1;
    } else {
      // Already On vacation — still (idempotently) claim ownership so we restore it later.
      await setHrOnLeave(person.id);
    }
  }

  // Restore anyone we previously set who is no longer on leave.
  let restored = 0;
  for (const managed of await listHrManagedLeave()) {
    if (onLeave.has(managed.email.trim().toLowerCase())) continue;
    await clearHrLeaveToAvailable(managed.id);
    await insertAuditLog({
      entityType: "person",
      entityId: managed.id,
      actorId: null,
      action: "hr_restore_available",
      oldValue: { status: "On vacation", source: "bamboohr" },
      newValue: { status: "Available" },
    });
    restored += 1;
  }

  if (setOnLeave > 0 || restored > 0) {
    publish({ type: "people" });
    publish({ type: "capacity-ranking" });
  }
  const summary = `Set ${setOnLeave} on vacation, restored ${restored}. ${onLeave.size} on matching leave today.`;
  await recordHrSync(summary);
  return { ran: true, setOnLeave, restored, summary };
}
