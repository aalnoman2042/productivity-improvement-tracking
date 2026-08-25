import { describe, expect, it } from "vitest";
import {
  DEFAULT_NUDGE,
  MAX_NUDGE,
  cleanNudge,
  nudgePayload,
  splitMessage,
} from "../lib/nudge";

describe("cleanNudge", () => {
  it("collapses whitespace and trims", () => {
    expect(cleanNudge("  Log your   day\nnow  ")).toBe("Log your day now");
  });

  it("is null for nothing worth sending", () => {
    expect(cleanNudge("   ")).toBeNull();
    expect(cleanNudge("")).toBeNull();
    expect(cleanNudge(null)).toBeNull();
    expect(cleanNudge(42)).toBeNull();
  });

  it("caps a message at a notification's length", () => {
    const long = cleanNudge("a".repeat(400));
    expect(long).toHaveLength(MAX_NUDGE);
  });
});

describe("splitMessage", () => {
  it("breaks the owner's message at the dash", () => {
    expect(splitMessage(DEFAULT_NUDGE)).toEqual({
      title: "Log your day now",
      body: "I'll predict your life.",
    });
  });

  it("breaks at the first full stop and keeps it", () => {
    expect(splitMessage("Log today. Three days missing.")).toEqual({
      title: "Log today.",
      body: "Three days missing.",
    });
  });

  it("takes the earliest break, whichever kind it is", () => {
    expect(splitMessage("Hey. You — log it")).toEqual({
      title: "Hey.",
      body: "You — log it",
    });
  });

  it("never invents a headline for one long clause", () => {
    const rambling =
      "you have not logged anything at all for the last several days and it shows";
    expect(splitMessage(rambling)).toEqual({
      title: "Log your day",
      body: rambling,
    });
  });

  it("uses a short unbroken message as the headline", () => {
    expect(splitMessage("Log your day")).toEqual({
      title: "Log your day",
      body: "",
    });
  });
});

describe("nudgePayload", () => {
  it("lands on the day the reader is living", () => {
    const push = nudgePayload(DEFAULT_NUDGE, "2026-08-25");
    expect(push.url).toBe("/?date=2026-08-25");
    expect(push.title).toBe("Log your day now");
    expect(push.body).toBe("I'll predict your life.");
  });

  it("does not share the daily ask's tag — a nudge can't swallow it", () => {
    const push = nudgePayload(DEFAULT_NUDGE, "2026-08-25");
    expect(push.tag).toBe("pit-nudge-2026-08-25");
    expect(push.tag).not.toContain("pit-reminder");
  });

  it("says what to do when the message was all headline", () => {
    expect(nudgePayload("Log your day", "2026-08-25").body).toBe(
      "Tap to log Tuesday 25 Aug."
    );
  });
});
