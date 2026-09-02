import { describe, expect, it } from "vitest";
import {
  ESTABLISHED_DAYS,
  QUIET_DAYS,
  fadingTrackers,
  quietLine,
  type FadingTracker,
  type TrackerLife,
} from "../lib/fading";

const TODAY = "2026-09-02";

const tracker = (over: Partial<FadingTracker> = {}): FadingTracker => ({
  id: "t1",
  name: "Gym",
  color: "1",
  type: "check",
  archived: false,
  ...over,
});

const life = (over: Partial<TrackerLife> = {}): TrackerLife => ({
  trackerId: "t1",
  last: "2026-08-01",
  days: 60,
  ...over,
});

describe("fadingTrackers — the habit that stopped without saying so", () => {
  it("names a tracker that was kept and has gone quiet", () => {
    const [q] = fadingTrackers([tracker()], [life()], TODAY);
    expect(q.name).toBe("Gym");
    expect(q.silent).toBe(32);
    expect(q.days).toBe(60);
  });

  it("says nothing about a tracker logged recently", () => {
    const recent = life({ last: "2026-08-30" });
    expect(fadingTrackers([tracker()], [recent], TODAY)).toEqual([]);
  });

  it("never asks about something that was only ever tried", () => {
    // Long gone, but it was answered on three days in its life.
    const tried = life({ days: ESTABLISHED_DAYS - 1 });
    expect(fadingTrackers([tracker()], [tried], TODAY)).toEqual([]);
  });

  it("never asks about one that has never been logged at all", () => {
    // A tracker made this morning has no history and is not faded.
    expect(fadingTrackers([tracker()], [], TODAY)).toEqual([]);
  });

  it("leaves archived trackers alone — that answer is already given", () => {
    expect(fadingTrackers([tracker({ archived: true })], [life()], TODAY)).toEqual([]);
  });

  it("puts the longest silence first", () => {
    const quiet = fadingTrackers(
      [tracker(), tracker({ id: "t2", name: "Reading" })],
      [
        life({ last: "2026-08-20" }),
        life({ trackerId: "t2", last: "2026-07-01" }),
      ],
      TODAY
    );
    expect(quiet.map((q) => q.name)).toEqual(["Reading", "Gym"]);
  });

  it("does not speak one day early", () => {
    const almost = life({ last: "2026-08-24" }); // exactly QUIET_DAYS - 1
    expect(fadingTrackers([tracker()], [almost], TODAY)).toEqual([]);
    const due = life({ last: "2026-08-23" }); // exactly QUIET_DAYS
    expect(fadingTrackers([tracker()], [due], TODAY)).toHaveLength(1);
    expect(QUIET_DAYS).toBe(10);
  });
});

describe("fadingTrackers — a day off is not silence", () => {
  it("does not offer to archive a habit you took a planned break from", () => {
    // Last logged 12 days ago, but ten of those were marked off on purpose.
    const rest = new Set([
      "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26",
      "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31",
    ]);
    const away = life({ last: "2026-08-21" });
    expect(fadingTrackers([tracker()], [away], TODAY)).toHaveLength(1);
    expect(fadingTrackers([tracker()], [away], TODAY, rest)).toEqual([]);
  });

  it("still reports the true gap, never a discounted one", () => {
    // Only the decision to speak discounts rest days; the number shown to the
    // reader is how long it has actually been.
    const rest = new Set(["2026-08-02"]);
    const [q] = fadingTrackers([tracker()], [life()], TODAY, rest);
    expect(q.silent).toBe(32);
  });

  it("is unaffected by rest days outside the gap", () => {
    const before = new Set(["2026-07-01", "2026-07-02"]);
    expect(fadingTrackers([tracker()], [life()], TODAY, before)).toHaveLength(1);
  });
});

describe("quietLine — a number without a verdict", () => {
  it("names the one, when there is one", () => {
    const [q] = fadingTrackers([tracker()], [life()], TODAY);
    expect(quietLine([q])).toBe("Gym has been quiet for 32 days.");
  });

  it("counts them, when there are several", () => {
    const quiet = fadingTrackers(
      [tracker(), tracker({ id: "t2", name: "Reading" })],
      [life(), life({ trackerId: "t2" })],
      TODAY
    );
    expect(quietLine(quiet)).toBe("2 trackers have been quiet for a while.");
  });

  it("says nothing about nothing", () => {
    expect(quietLine([])).toBe("");
  });
});
