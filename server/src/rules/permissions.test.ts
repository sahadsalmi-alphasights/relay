import { afterEach, describe, expect, it } from "vitest";
import {
  canArchiveProject,
  canEditAssignmentProgress,
  canEditGoal,
  canEditProjectFields,
  canEditSundayRota,
  canManageTeamRoster,
  canRequestGoalChange,
  canSetEveningCoverage,
  canSetPersonStatus,
} from "./permissions";
import { PERMISSION_DEFAULTS, replacePermissionMatrix, resetPermissionMatrix } from "./permissionMatrix";

describe("§5e/§7b — the PL owns the goal; managers and owners have full project control", () => {
  const project = { plId: "pl-1" };

  it("lets the PL edit goal/custom_goal", () => {
    expect(canEditGoal({ id: "pl-1" }, project)).toBe(true);
  });

  it("never lets a plain member edit goal/custom_goal, even on their own assignment", () => {
    expect(canEditGoal({ id: "deliverer-1" }, project)).toBe(false);
    expect(canEditGoal({ id: "deliverer-1", isManager: false, isOwner: false }, project)).toBe(false);
  });

  it("lets a manager edit any project's goals (§7b update 2026-07-21)", () => {
    expect(canEditGoal({ id: "mgr-1", isManager: true }, project)).toBe(true);
  });

  it("lets an owner edit any project's goals", () => {
    expect(canEditGoal({ id: "own-1", isOwner: true }, project)).toBe(true);
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

describe("User-groups matrix — group grants are adjustable; owners are not", () => {
  afterEach(() => resetPermissionMatrix());

  it("granting members projects.edit_any lets a plain member edit any project", () => {
    replacePermissionMatrix({
      manager: { ...PERMISSION_DEFAULTS.manager },
      member: { ...PERMISSION_DEFAULTS.member, "projects.edit_any": true },
    });
    expect(canEditProjectFields({ id: "m-1" }, { plId: "pl-1" })).toBe(true);
  });

  it("revoking managers' archive/delete stops managers — but never an owner, and never the PL themselves", () => {
    replacePermissionMatrix({
      manager: { ...PERMISSION_DEFAULTS.manager, "projects.archive_delete": false },
      member: { ...PERMISSION_DEFAULTS.member },
    });
    expect(canArchiveProject({ id: "mgr-1", isManager: true }, { plId: "pl-1" })).toBe(false);
    expect(canArchiveProject({ id: "own-1", isOwner: true }, { plId: "pl-1" })).toBe(true);
    expect(canArchiveProject({ id: "pl-1", isManager: true }, { plId: "pl-1" })).toBe(true);
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
