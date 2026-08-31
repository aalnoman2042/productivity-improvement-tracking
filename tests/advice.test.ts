import { describe, expect, it } from "vitest";
import { buildAdvice } from "../lib/advice";
import { toNight } from "../lib/clock";
import type { Stats, Summary } from "../lib/stats";
import type { Tracker } from "../lib/trackers";

const night = (t: string) => toNight(t) as number;

const mkTracker = (over: Partial<Tracker> & { id: string }): Tracker => ({
  name: over.id,
  type: "duration",
  unit: "min",
  color: "#2a78d6",
  category: "study",
  goal: null,
  archived: false,
  order: 0,
  ...over,
});

const mkSummary = (over: Partial<Summary>): Summary => ({
  sum: 0,
  days: 0,
  best: 0,
  bestDate: null,
  avgPerDay: 0,
  avgPerLoggedDay: 0,
  goal: null,
  previous: { sum: 0, days: 0, value: 0 },
  changePct: null,
  streak: null,
  clock: null,
  ...over,
});

function mkStats(
  trackers: Tracker[],
  summary: Record<string, Summary>,
  over: Partial<Stats> = {}
): Stats {
  return {
    period: "week",
    start: "2026-08-01",
    end: "2026-08-07",
    unitEnd: "2026-08-07",
    partial: false,
    live: true,
    firstLogged: "2026-08-01",
    days: 7,
    granularity: "day",
    trackers,
    buckets: [],
    summary,
    streak: 0,
    restDays: 0,
    daysLogged: 7,
    prevDaysLogged: 0,
    hasEntries: true,
    ...over,
  };
}

describe("buildAdvice", () => {
  it("says nothing when nothing needs fixing", () => {
    const t = mkTracker({ id: "sleep", type: "sleep" });
    const stats = mkStats([t], {
      sleep: mkSummary({
        days: 7,
        avgPerLoggedDay: 450, // 7h30m
        clock: {
          nights: 7,
          bed: night("23:00"),
          wake: night("06:30"),
          earliestBed: night("22:30"),
          latestBed: night("23:30"),
          latestBedDate: null,
          prevBed: null,
        },
      }),
    });
    expect(buildAdvice(stats)).toEqual([]);
  });

  it("tells a 2 am sleeper to get to bed before 12, as the top item", () => {
    const t = mkTracker({ id: "sleep", type: "sleep" });
    const stats = mkStats([t], {
      sleep: mkSummary({
        days: 7,
        avgPerLoggedDay: 430,
        clock: {
          nights: 7,
          bed: night("02:00"),
          wake: night("09:10"),
          earliestBed: night("01:00"),
          latestBed: night("03:00"),
          latestBedDate: null,
          prevBed: null,
        },
      }),
    });
    const advice = buildAdvice(stats);
    expect(advice[0].focus).toBe("Get to bed before 12");
    expect(advice[0].level).toBe("bad");
    expect(advice[0].why).toContain("2:00 am");
  });

  it("flags short sleep separately from late sleep", () => {
    const t = mkTracker({ id: "sleep", type: "sleep" });
    const stats = mkStats([t], {
      sleep: mkSummary({ days: 7, avgPerLoggedDay: 330 }), // 5h30m, no clock
    });
    const advice = buildAdvice(stats);
    expect(advice).toHaveLength(1);
    expect(advice[0].focus).toBe("Sleep at least 7 hours");
    expect(advice[0].level).toBe("bad");
  });

  it("puts thin logging above everything else", () => {
    const t = mkTracker({ id: "sleep", type: "sleep" });
    const stats = mkStats(
      [t],
      {
        sleep: mkSummary({
          days: 3,
          avgPerLoggedDay: 400,
          clock: {
            nights: 3,
            bed: night("02:30"),
            wake: night("10:00"),
            earliestBed: night("02:00"),
            latestBed: night("03:00"),
            latestBedDate: null,
            prevBed: null,
          },
        }),
      },
      { daysLogged: 3 } // 3 of 7
    );
    const advice = buildAdvice(stats);
    expect(advice[0].focus).toBe("Log every day first");
    expect(advice[1].focus).toBe("Get to bed before 12");
  });

  it("turns a struggling goal into an instruction, and leaves a held one alone", () => {
    const failing = mkTracker({
      id: "study",
      name: "Self study",
      goal: { target: 180, period: "day", direction: "min" },
    });
    const holding = mkTracker({
      id: "water",
      name: "Water",
      type: "count",
      unit: "glasses",
      goal: { target: 8, period: "day", direction: "min" },
    });
    const stats = mkStats([failing, holding], {
      study: mkSummary({ days: 3, goal: { met: 2, total: 7 } }),
      water: mkSummary({ days: 7, goal: { met: 6, total: 7 } }),
    });
    const advice = buildAdvice(stats);
    expect(advice).toHaveLength(1);
    expect(advice[0].focus).toBe("Give Self study its 3h a day");
    expect(advice[0].why).toContain("2 of 7");
  });

  it("tells a reset streak to restart today", () => {
    const t = mkTracker({ id: "nofap", name: "No fap", type: "streak" });
    const stats = mkStats([t], {
      nofap: mkSummary({
        days: 7,
        sum: 5, // two slip days in the period
        streak: { current: 0, best: 21, slips: 4, lastSlip: "2026-08-07", since: "2026-06-01" },
      }),
    });
    const advice = buildAdvice(stats);
    expect(advice[0].focus).toBe("Restart No fap today");
    expect(advice[0].why).toContain("21");
  });

  it("calls out a growing bad habit as falling behind", () => {
    const t = mkTracker({
      id: "junk",
      name: "Junk food",
      type: "count",
      unit: "times",
      habit: "bad",
    });
    const stats = mkStats([t], {
      junk: mkSummary({
        days: 5,
        sum: 9,
        previous: { sum: 4, days: 3, value: 4 },
        changePct: 125,
      }),
    });
    const advice = buildAdvice(stats);
    expect(advice[0].focus).toBe("Cut Junk food back down");
    expect(advice[0].level).toBe("bad");
    expect(advice[0].why).toContain("125%");
  });

  it("warns when a good habit slides, but stays quiet when it holds", () => {
    const sliding = mkTracker({ id: "read", name: "Reading" });
    const holding = mkTracker({ id: "gym", name: "Gym" });
    const stats = mkStats([sliding, holding], {
      read: mkSummary({
        days: 3,
        sum: 60,
        previous: { sum: 180, days: 6, value: 180 },
        changePct: -66,
      }),
      gym: mkSummary({
        days: 6,
        sum: 300,
        previous: { sum: 280, days: 6, value: 280 },
        changePct: 7,
      }),
    });
    const advice = buildAdvice(stats);
    expect(advice).toHaveLength(1);
    expect(advice[0].focus).toBe("Don't let Reading slide");
  });

  it("flags sleep well past its own 7h goal", () => {
    const t = mkTracker({
      id: "sleep",
      type: "sleep",
      goal: { target: 420, period: "day", direction: "min" },
    });
    const stats = mkStats([t], {
      sleep: mkSummary({ days: 6, avgPerLoggedDay: 540 }), // 9h against a 7h goal
    });
    const advice = buildAdvice(stats);
    expect(advice).toHaveLength(1);
    expect(advice[0].focus).toBe("Cap sleep around 7h");
    expect(advice[0].why).toContain("2h past your 7h goal");
  });

  it("leaves sleep alone when it's merely a healthy bit over", () => {
    const t = mkTracker({
      id: "sleep",
      type: "sleep",
      goal: { target: 420, period: "day", direction: "min" },
    });
    const stats = mkStats([t], {
      sleep: mkSummary({ days: 6, avgPerLoggedDay: 460 }), // 7h40m
    });
    expect(buildAdvice(stats)).toEqual([]);
  });

  it("prays: advises anchoring the most-missed prayer", () => {
    const t = mkTracker({ id: "namaz", name: "Namaz", type: "prayer" });
    const stats = mkStats([t], {
      namaz: mkSummary({ days: 7, avgPerLoggedDay: 3.1 }),
    });
    const advice = buildAdvice(stats);
    expect(advice[0].focus).toBe("Get all five prayers in");
    expect(advice[0].level).toBe("bad");
  });
});
