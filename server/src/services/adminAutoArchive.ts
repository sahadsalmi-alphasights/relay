import { insertAuditLog } from "../repositories/auditLog";
import { listAssignmentsByProject } from "../repositories/assignments";
import { closeDeliveryForProject, listProjectsIdleInSelling } from "../repositories/projects";
import { ADMIN_AUTO_ARCHIVE_DAYS } from "../rules/config";
import { publish } from "../ws/hub";
import { projectRecipientIds } from "../ws/recipients";

/**
 * Auto-archive-for-deliverers: a project whose every active assignment has sat
 * in Selling ("Admin") — the terminal, zero-load stage — for ADMIN_AUTO_ARCHIVE_DAYS
 * or more is doing nothing on the deliverers' boards. We close its delivery
 * (off every deliverer's board, still on the PL's), the same state the manual
 * "Archive for all deliverers only" produces, so PLs no longer sweep parked
 * cards by hand.
 *
 * Like the stale scheduler this is time-driven, not event-driven: nobody acts,
 * time simply passes. It's idempotent — a closed project drops out of the
 * candidate query on the next tick — so re-running is safe.
 */
export async function checkAdminAutoArchive(now: Date, thresholdDays = ADMIN_AUTO_ARCHIVE_DAYS): Promise<number> {
  const beforeIso = new Date(now.getTime() - thresholdDays * 24 * 60 * 60 * 1000).toISOString();
  const stale = await listProjectsIdleInSelling(beforeIso);

  for (const p of stale) {
    await closeDeliveryForProject(p.projectId);
    // actorId null = system action; distinct action name so the audit trail
    // separates auto-archives from a PL's manual "close_delivery".
    await insertAuditLog({
      entityType: "project",
      entityId: p.projectId,
      actorId: null,
      action: "close_delivery_auto",
      newValue: { reason: "idle_in_admin", thresholdDays, latestStageEnteredAt: p.latestStageEnteredAt },
    });

    const assignments = await listAssignmentsByProject(p.projectId);
    const recipients = await projectRecipientIds([p.plId, ...assignments.map((a) => a.delivererId)]);
    publish({ type: "project", projectId: p.projectId }, recipients);
  }

  if (stale.length > 0) publish({ type: "capacity-ranking" });
  return stale.length;
}

/** `.unref()`'d so it never keeps the process (or a test) alive on its own. */
export function startAdminAutoArchiveScheduler(intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => {
    checkAdminAutoArchive(new Date()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("admin auto-archive scheduler tick failed", err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
