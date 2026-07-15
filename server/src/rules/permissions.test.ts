import { describe, expect, it } from "vitest";
import {
  canEditAssignmentProgress,
  canEditGoal,
  canEditSundayRota,
  canManageTeamRoster,
  canRequestGoalChange,
  canSetEveningCoverage,
  canSetPersonStatus,
} from "./permissions";

describe("§5e — the PL owns the goal, always", () => {
  const project = { plId: "pl-1" };

  it("lets the PL edit goal/custom_goal", () => {
    expect(canEditGoal("pl-1", project)).toBe(true);
  });

  it("never lets a deliverer edit goal/custom_goal, even on their own assignment", () => {
    expect(canEditGoal("deliverer-1", project)).toBe(false);
  });
});

describe("§5e — a deliverer may edit only their own progress, and only request goal changes", () => {
  const assignment = { delivererId: "d-1" };

  it("lets the assignment's own deliverer edit delivered/custom_delivered", () => {
    expect(canEditAssignmentProgress("d-1", assignment)).toBe(true);
  });

  it("blocks a different deliverer from editing someone else's assignment", () => {
    expect(canEditAssignmentProgress("d-2", assignment)).toBe(false);
  });

  it("lets the assignment's own deliverer request a goal change", () => {
    expect(canRequestGoalChange("d-1", assignment)).toBe(true);
  });
});

describe("§7b — manager powers are scoped to their own team only", () => {
  const managerOfAlpha = { isManager: true, teamId: "alpha" };
  const nonManagerOfAlpha = { isManager: false, teamId: "alpha" };

  it("lets a manager set status for their own team", () => {
    expect(canSetPersonStatus(managerOfAlpha, { teamId: "alpha" })).toBe(true);
  });

  it("blocks a manager from setting status on another team", () => {
    expect(canSetPersonStatus(managerOfAlpha, { teamId: "beta" })).toBe(false);
  });

  it("blocks a non-manager regardless of team", () => {
    expect(canSetPersonStatus(nonManagerOfAlpha, { teamId: "alpha" })).toBe(false);
  });

  it("scopes Sunday rota editing and roster management the same way", () => {
    expect(canEditSundayRota(managerOfAlpha, { teamId: "alpha" })).toBe(true);
    expect(canEditSundayRota(managerOfAlpha, { teamId: "beta" })).toBe(false);
    expect(canManageTeamRoster(managerOfAlpha, { teamId: "alpha" })).toBe(true);
    expect(canManageTeamRoster(managerOfAlpha, { teamId: "beta" })).toBe(false);
  });
});

describe("§4 Rule 3 / §7b — evening_coverage is self-serve only, not even a manager can set it", () => {
  it("lets a person set their own toggle", () => {
    expect(canSetEveningCoverage("p-1", "p-1")).toBe(true);
  });

  it("blocks anyone else, including implicitly a manager, from setting it for them", () => {
    expect(canSetEveningCoverage("manager-1", "p-1")).toBe(false);
  });
});
