import { describe, expect, it } from "vitest";
import {
  canManageTeamRoster,
  canManageUsers,
  canSetPersonStatus,
  type ManagerActor,
} from "./permissions";

const owner: ManagerActor = { isOwner: true, isManager: false, teamId: null };
const managerA: ManagerActor = { isOwner: false, isManager: true, teamId: "team-A" };
const member: ManagerActor = { isOwner: false, isManager: false, teamId: "team-A" };

describe("owner is a superset of manager", () => {
  it("owner can set status / manage roster on any team", () => {
    expect(canSetPersonStatus(owner, { teamId: "team-B" })).toBe(true);
    expect(canManageTeamRoster(owner, { teamId: "team-Z" })).toBe(true);
  });

  it("manager is still limited to their own team", () => {
    expect(canSetPersonStatus(managerA, { teamId: "team-A" })).toBe(true);
    expect(canSetPersonStatus(managerA, { teamId: "team-B" })).toBe(false);
    expect(canManageTeamRoster(managerA, { teamId: "team-B" })).toBe(false);
  });

  it("member can manage neither", () => {
    expect(canSetPersonStatus(member, { teamId: "team-A" })).toBe(false);
    expect(canManageTeamRoster(member, { teamId: "team-A" })).toBe(false);
  });
});

describe("user management is owner-only", () => {
  it("only owners may manage users", () => {
    expect(canManageUsers(owner)).toBe(true);
    expect(canManageUsers(managerA)).toBe(false);
    expect(canManageUsers(member)).toBe(false);
    expect(canManageUsers({})).toBe(false);
  });
});
