import { describe, expect, it } from "vitest";
import { loggingRun, nightlyMessage, type StakeInput } from "../lib/stakes";

/**
 * The nightly ask picks one message from a ladder. These pin the order, and —
 * the one that matters most — that a clean streak is never described as being
 * at risk on a blank day, because it isn't.
 */

const TODAY = "2026-08-14";

const input = (over: Partial<StakeInput> = {}): StakeInput => ({
  date: TODAY,
  loggedToday: false,
  loggingStreak: 0,
  streaks: [],
  challenges: [],
  ...over,
});

const challenge = (over: Partial<StakeInput["challenges"][0]> = {}) => ({
  name: "Quran",
  status: "active",
  dayNumber: 12,
  days: 30,
  todayMet: false,
  ...over,
});

describe("nightlyMessage", () => {
  it("falls back to the ask the reminder has always made", () => {
    const s = nightlyMessage(input({ loggedToday: true }));
    expect(s.kind).toBe("plain");
    expect(s.title).toBe("The day is finished — how was it?");
    expect(s.body).toContain("Friday 14 Aug");
    expect(s.url).toBe(`/?date=${TODAY}`);
  });

  it("celebrates a milestone crossed today, above everything else", () => {
    const s = nightlyMessage(
      input({
        streaks: [{ name: "No fap", current: 30 }],
        challenges: [challenge({ dayNumber: 30 })],
        loggingStreak: 20,
      })
    );
    expect(s.kind).toBe("milestone");
    expect(s.title).toContain("30 days clean — No fap");
  });

  it("only calls it a milestone on the day it is crossed", () => {
    // 34 days is past 30, but the crossing was four nights ago — the weekly
    // digest's job, not the nightly ask's.
    expect(nightlyMessage(input({ streaks: [{ name: "No fap", current: 34 }] })).kind).toBe(
      "plain"
    );
    expect(nightlyMessage(input({ streaks: [{ name: "No fap", current: 7 }] })).kind).toBe(
      "milestone"
    );
  });

  it("takes the biggest milestone when two land at once", () => {
    const s = nightlyMessage(
      input({
        streaks: [
          { name: "No fap", current: 7 },
          { name: "No smoking", current: 100 },
        ],
      })
    );
    expect(s.title).toContain("100 days clean — No smoking");
  });

  it("leads with the challenge that ends tonight", () => {
    const s = nightlyMessage(
      input({
        challenges: [challenge(), challenge({ name: "Workout", dayNumber: 30, days: 30 })],
        loggingStreak: 20,
      })
    );
    expect(s.kind).toBe("challenge-last");
    expect(s.title).toBe("Day 30 of 30 — Workout");
    expect(s.body).toContain("finishes it");
  });

  it("nudges a challenge day that hasn't been earned yet", () => {
    const s = nightlyMessage(input({ challenges: [challenge()], loggingStreak: 20 }));
    expect(s.kind).toBe("challenge");
    expect(s.title).toBe("Day 12 of 30 — Quran");
  });

  it("stays quiet about challenges that are already met or over", () => {
    const s = nightlyMessage(
      input({
        challenges: [
          challenge({ todayMet: true }),
          challenge({ name: "Old", status: "ended" }),
        ],
      })
    );
    expect(s.kind).toBe("plain");
  });

  it("warns about the logging run, and only when it's worth saving", () => {
    const s = nightlyMessage(input({ loggingStreak: 12 }));
    expect(s.kind).toBe("streak");
    expect(s.title).toBe("12 days in a row");
    expect(s.body).toContain("still blank");

    // Short runs, and days already logged, get the ordinary ask.
    expect(nightlyMessage(input({ loggingStreak: 4 })).kind).toBe("plain");
    expect(
      nightlyMessage(input({ loggingStreak: 12, loggedToday: true })).kind
    ).toBe("plain");
  });

  it("never claims a clean streak is at risk — it isn't", () => {
    // A long clean streak, nothing logged today, no logging run behind it.
    // Missing a log does not break a clean streak, so nothing may imply it.
    const s = nightlyMessage(
      input({ streaks: [{ name: "No fap", current: 34 }], loggedToday: false })
    );
    expect(s.kind).toBe("plain");
    expect(`${s.title} ${s.body}`).not.toMatch(/streak|clean|break|lose/i);
  });
});

describe("loggingRun", () => {
  const days = (...ds: string[]) => new Set(ds);

  it("counts back from today when today is logged", () => {
    expect(
      loggingRun(days("2026-08-12", "2026-08-13", "2026-08-14"), TODAY)
    ).toBe(3);
  });

  it("counts back from yesterday when today is still blank", () => {
    // The day isn't over — a blank today doesn't end the run yet.
    expect(loggingRun(days("2026-08-12", "2026-08-13"), TODAY)).toBe(2);
  });

  it("stops at the first gap, and is zero with nothing to count", () => {
    expect(loggingRun(days("2026-08-10", "2026-08-13"), TODAY)).toBe(1);
    expect(loggingRun(days(), TODAY)).toBe(0);
  });
});
