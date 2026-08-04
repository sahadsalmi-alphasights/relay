import { describe, expect, it } from "vitest";
import { goalChangeButtons, slackRouteFor } from "./slack";

describe("slackRouteFor", () => {
  it("routes everything to the channel when no bot token (legacy mode)", () => {
    expect(slackRouteFor("assigned", false)).toBe("channel");
    expect(slackRouteFor("goal_change_requested", false)).toBe("channel");
    expect(slackRouteFor("open_pool", false)).toBe("channel");
  });

  it("DMs personal events in DM mode", () => {
    expect(slackRouteFor("assigned", true)).toBe("dm");
    expect(slackRouteFor("goal_change_requested", true)).toBe("dm");
    expect(slackRouteFor("goal_change_resolved", true)).toBe("dm");
    expect(slackRouteFor("delivery_logged", true)).toBe("dm");
    expect(slackRouteFor("stale_first_deliverable", true)).toBe("dm");
    expect(slackRouteFor("project_transferred", true)).toBe("dm");
  });

  it("skips team events in DM mode (broadcast posts them to the channel once)", () => {
    expect(slackRouteFor("open_pool", true)).toBe("skip");
  });
});

describe("goalChangeButtons", () => {
  it("offers Accept, Amend and Decline, each carrying the request id", () => {
    const buttons = goalChangeButtons("gcr-123");
    expect(buttons.map((b) => b.actionId)).toEqual([
      "accept_goal_change",
      "amend_goal_change",
      "decline_goal_change",
    ]);
    expect(buttons.every((b) => b.value === "gcr-123")).toBe(true);
    // Accept is primary, Decline is danger, Amend is neutral.
    expect(buttons[0].style).toBe("primary");
    expect(buttons[1].style).toBeUndefined();
    expect(buttons[2].style).toBe("danger");
  });
});
