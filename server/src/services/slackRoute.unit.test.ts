import { describe, expect, it } from "vitest";
import { goalChangeButtons, messageAttachments, slackRouteFor } from "./slack";

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

describe("messageAttachments", () => {
  // A fixed timestamp so the context footer is deterministic.
  const NOW = 1_700_000_000_000;

  it("wraps the message in one colored attachment with a header, body and footer", () => {
    const [att] = messageAttachments("stale_first_deliverable", "First Deliverable due", "…15+ hours…", undefined, NOW) as [
      { color: string; blocks: { type: string; text?: { text: string } }[] }
    ];
    expect(att.color).toBe("#e01e5a"); // urgent = red
    const types = att.blocks.map((b) => b.type);
    expect(types).toEqual(["header", "section", "context"]); // no actions when no buttons
    // Header carries the type emoji + title.
    expect(att.blocks[0].text?.text).toBe("⏱️ First Deliverable due");
    // Footer renders a Slack-native relative timestamp for the given instant.
    const footer = JSON.stringify(att.blocks[2]);
    expect(footer).toContain("CapTracker");
    expect(footer).toContain(`<!date^${Math.floor(NOW / 1000)}^{time}|just now>`);
  });

  it("adds an actions block when buttons are supplied, and uses the type's emoji/color", () => {
    const [att] = messageAttachments("goal_change_requested", "Goal change requested", "body", goalChangeButtons("gcr-1"), NOW) as [
      { color: string; blocks: { type: string; text?: { text: string } }[] }
    ];
    expect(att.color).toBe("#ecb22e"); // attention = amber
    expect(att.blocks.map((b) => b.type)).toEqual(["header", "section", "actions", "context"]);
    expect(att.blocks[0].text?.text).toBe("🎯 Goal change requested");
  });

  it("falls back to a neutral bell for an unknown type", () => {
    const [att] = messageAttachments("something_new", "Heads up", "body", undefined, NOW) as [
      { color: string; blocks: { text?: { text: string } }[] }
    ];
    expect(att.color).toBe("#616061");
    expect(att.blocks[0].text?.text).toBe("🔔 Heads up");
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
