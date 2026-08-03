import { describe, expect, it } from "vitest";
import { slackRouteFor } from "./slack";

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
