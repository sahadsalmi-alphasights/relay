export interface AssignmentRecord {
  id: string;
  projectId: string;
  delivererId: string;
  goal: number;
  delivered: number;
  customGoal: number;
  customDelivered: number;
}

export interface AuditLogEntry {
  entityType: "assignment";
  entityId: string;
  actorId: string;
  action: "swap_deliverer";
  oldValue: { delivererId: string; delivered: number; customDelivered: number };
  newValue: { delivererId: string; delivered: number; customDelivered: number };
}

export interface SwapResult {
  assignment: AssignmentRecord;
  auditEntry: AuditLogEntry;
}

/**
 * §5f — reassigning an assignment to a new deliverer keeps its
 * delivered/custom_delivered counts (progress is preserved; the new person
 * inherits the remaining work). Credit for what was already delivered stays
 * attributed to the original person — recorded here in the audit entry so a
 * later stats report can still attribute historical delivery correctly, even
 * though the assignment row itself now points at the new deliverer.
 */
export function swapDeliverer(
  assignment: AssignmentRecord,
  newDelivererId: string,
  actorId: string
): SwapResult {
  const originalDelivererId = assignment.delivererId;
  return {
    assignment: { ...assignment, delivererId: newDelivererId },
    auditEntry: {
      entityType: "assignment",
      entityId: assignment.id,
      actorId,
      action: "swap_deliverer",
      oldValue: {
        delivererId: originalDelivererId,
        delivered: assignment.delivered,
        customDelivered: assignment.customDelivered,
      },
      newValue: {
        delivererId: newDelivererId,
        delivered: assignment.delivered,
        customDelivered: assignment.customDelivered,
      },
    },
  };
}
