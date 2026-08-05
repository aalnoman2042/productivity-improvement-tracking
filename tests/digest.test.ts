import { describe, expect, it } from "vitest";
import { prayerLine, sleepLine, streakLine } from "../lib/digest";

/** Shorthand for the loose Mongo-document shape the digest reads. */
const entry = (value: number, meta?: object) => ({ value, meta }) as never;

describe("sleepLine", () => {
  it("says nothing about an empty week", () => {
    expect(sleepLine([], [])).toBeNull();
  });

  it("averages the week and compares bedtime with the one before", () => {
    const current = [
      entry(420, { start: "23:00" }),
      entry(480, { start: "23:30" }),
    ];
    const previous = [
      entry(400, { start: "23:40" }),
      entry(410, { start: "23:50" }),
    ];
    // now avg 23:15, before avg 23:45 → 30 min earlier.
    expect(sleepLine(current, previous)).toBe(
      "Sleep 7h 30m a night, bedtime 30 min earlier than last week."
    );
  });

  it("falls back to the bedtime itself with no previous week", () => {
    const current = [
      entry(420, { start: "23:00" }),
      entry(420, { start: "23:00" }),
    ];
    expect(sleepLine(current, [])).toBe(
      "Sleep 7h a night, in bed around 11:00 pm."
    );
  });
});

describe("prayerLine", () => {
  it("congratulates a full week", () => {
    const week = [entry(5, { parts: ["fajr", "dhuhr", "asr", "maghrib", "isha"] })];
    expect(prayerLine("Namaz", week)).toBe(
      "Namaz: all five prayers, every day you logged."
    );
  });

  it("names the most-missed prayer", () => {
    const week = [
      entry(4, { parts: ["dhuhr", "asr", "maghrib", "isha"] }),
      entry(4, { parts: ["dhuhr", "asr", "maghrib", "isha"] }),
      entry(5, { parts: ["fajr", "dhuhr", "asr", "maghrib", "isha"] }),
    ];
    expect(prayerLine("Namaz", week)).toBe(
      "Namaz 4.3/5 — Fajr missed most (2 of 3 days)."
    );
  });

  it("still gives the average when no day recorded which prayers", () => {
    expect(prayerLine("Namaz", [entry(3), entry(4)])).toBe("Namaz 3.5/5 a day.");
  });
});

describe("streakLine", () => {
  it("reports the run", () => {
    expect(streakLine("No fap", "2026-08-01", [], "2026-08-05")).toBe(
      "No fap: 5 days clean."
    );
  });

  it("celebrates a milestone crossed this week", () => {
    // 33 days: crossed 30 within the last 7.
    expect(streakLine("No fap", "2026-07-04", [], "2026-08-05")).toBe(
      "🎉 No fap: past 30 days clean — 33 and counting."
    );
  });

  it("does not keep celebrating an old milestone", () => {
    // 46 days: 30 was crossed over two weeks ago.
    expect(streakLine("No fap", "2026-06-21", [], "2026-08-05")).toBe(
      "No fap: 46 days clean."
    );
  });

  it("says so when the streak reset", () => {
    expect(
      streakLine("No fap", "2026-08-01", ["2026-08-05"], "2026-08-05")
    ).toBe("No fap: the streak reset — back to day one.");
  });
});
