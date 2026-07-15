import { describe, expect, it } from "vitest";
import { swapDeliverer, type AssignmentRecord } from "./swap";

describe("swapDeliverer — §5f", () => {
  const original: AssignmentRecord = {
    id: "a-1",
    projectId: "p-1",
    delivererId: "person-old",
    goal: 8,
    delivered: 3,
    customGoal: 1,
    customDelivered: 1,
  };

  it("keeps delivered/custom_delivered counts — the new person inherits remaining work, not a reset", () => {
    const { assignment } = swapDeliverer(original, "person-new", "pl-1");
    expect(assignment.delivered).toBe(3);
    expect(assignment.customDelivered).toBe(1);
    expect(assignment.goal).toBe(8);
    expect(assignment.customGoal).toBe(1);
  });

  it("points the assignment at the new deliverer", () => {
    const { assignment } = swapDeliverer(original, "person-new", "pl-1");
    expect(assignment.delivererId).toBe("person-new");
  });

  it("records an audit entry crediting the original person for what was already delivered", () => {
    const { auditEntry } = swapDeliverer(original, "person-new", "pl-1");
    expect(auditEntry.oldValue).toEqual({
      delivererId: "person-old",
      delivered: 3,
      customDelivered: 1,
    });
    expect(auditEntry.newValue.delivererId).toBe("person-new");
    expect(auditEntry.actorId).toBe("pl-1");
  });
});
