import { describe, expect, it } from "vitest";
import { buildCoachFacts, type CoachEntry } from "../lib/coachFacts";
import { buildReportCard } from "../lib/report";
import type { Tracker } from "../lib/trackers";

/**
 * The coach is only as honest as the numbers it is handed. These fix the
 * numbers: a rising week, a bad habit growing, a bedtime that averages
 * across midnight without landing at lunchtime.
 */

const TODAY = "2026-08-14";
/** The window is 1–14 Aug; the last seven days start here. */
const WEEK2 = "2026-08-08";

const tracker = (over: Partial<Tracker> & Pick<Tracker, "id" | "name" | "type">): Tracker => ({
  unit: "",
  color: "#000000",
  category: "other",
  goal: null,
  archived: false,
  order: 0,
  ...over,
});

const TRACKERS: Tracker[] = [
  tracker({
    id: "study",
    name: "Self study",
    type: "duration",
    unit: "min",
    category: "study",
    goal: { target: 120, period: "day", direction: "min" },
  }),
  tracker({
    id: "junk",
    name: "Junk food",
    type: "count",
    unit: "times",
    category: "food",
    habit: "bad",
  }),
  tracker({
    id: "sleep",
    name: "Sleep",
    type: "sleep",
    unit: "min",
    category: "sleep",
    goal: { target: 420, period: "day", direction: "min" },
  }),
  tracker({ id: "nofap", name: "No fap", type: "streak", category: "discipline" }),
];

/** Aug 1–14: study doubles in week two, junk food doubles with it. */
function entries(): CoachEntry[] {
  const rows: CoachEntry[] = [];
  for (let day = 1; day <= 14; day++) {
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    const week2 = date >= WEEK2;
    rows.push({ trackerId: "study", date, value: week2 ? 120 : 60 });
    rows.push({ trackerId: "junk", date, value: week2 ? 2 : 1 });
    rows.push({
      trackerId: "sleep",
      date,
      value: 420,
      // Seven nights at 11 pm, seven at 1 am — an average that only works
      // on the night axis.
      meta: week2 ? { start: "01:00", end: "08:00" } : { start: "23:00", end: "06:00" },
    });
    rows.push({ trackerId: "nofap", date, value: 1 });
  }
  return rows;
}

function build(rows = entries(), rest: string[] = [], trackers = TRACKERS) {
  const report = buildReportCard(trackers, rows, [], TODAY, rest);
  return buildCoachFacts(trackers, rows, [], report, TODAY, rest);
}

const find = (facts: ReturnType<typeof build>["facts"], name: string) =>
  facts.trackers.find((t) => t.name === name)!;

describe("buildCoachFacts", () => {
  it("covers the whole window, day by day", () => {
    const { facts, snapshot } = build();
    expect(facts.window).toEqual({ days: 14, from: "2026-08-01", to: TODAY });
    expect(facts.last14Days).toHaveLength(14);
    expect(snapshot.days).toHaveLength(14);
    expect(snapshot.daysLogged).toBe(14);
    // The weekday is in the label, because a weekend dip is a finding.
    expect(facts.last14Days[0].day).toBe("Saturday 1 Aug");
  });

  it("scores the better week higher and calls the momentum", () => {
    const { snapshot, facts } = build();
    expect(snapshot.prevAvg7).toBe(68);
    expect(snapshot.avg7).toBe(93);
    expect(snapshot.momentum).toBe("rising");
    expect(facts.rightNow.momentum).toBe("rising");
    expect(facts.rightNow.dayScore).toBe(93);
  });

  it("reads a rise as better for a good habit and worse for a bad one", () => {
    const { facts } = build();

    const study = find(facts, "Self study");
    expect(study.last7Days).toBe("14h total");
    expect(study.previous7Days).toBe("7h total");
    expect(study.change).toBe("up 100%");
    expect(study.readsAs).toBe("better");

    const junk = find(facts, "Junk food");
    expect(junk.change).toBe("up 100%");
    expect(junk.readsAs).toBe("worse");
    expect(junk.habit).toBe("bad");
  });

  it("counts goal days the way the rest of the app counts them", () => {
    const { facts } = build();
    // 120 minutes clears the goal only in week two.
    expect(find(facts, "Self study").goalHit).toBe("7/14 days");
    expect(find(facts, "Sleep").goalHit).toBe("14/14 days");
    expect(find(facts, "Junk food").goalHit).toBeNull();
  });

  it("averages bedtimes across midnight, not around it", () => {
    const { facts, snapshot } = build();
    const clock = find(facts, "Sleep").sleepClock!;
    // 11 pm and 1 am average to midnight — a plain clock average says noon.
    expect(clock.avgBedtime).toBe("12:00 am");
    expect(clock.avgWakeUp).toBe("7:00 am");
    expect(clock.nights).toBe(14);
    expect(clock.nightsPastMidnight).toBe(7);
    expect(clock.latestBedtime).toContain("1:00 am");
    expect(snapshot.sleep).toBe("7h a night · bed 12:00 am");
  });

  it("carries the streak and the grade the model would otherwise invent", () => {
    const { facts } = build();
    const streak = find(facts, "No fap").streak!;
    // Counted from the boundary before the first entry — 1 Aug through today.
    expect(streak.currentCleanDays).toBe(14);
    expect(streak.slipsAllTime).toBe(0);
    expect(find(facts, "Self study").grade).toBeTruthy();
    expect(find(facts, "Self study").gradedOn).toBe("goals hit");
  });

  it("says so plainly when there is nothing to compare against", () => {
    const rows = entries().filter((e) => e.date >= WEEK2);
    const { facts, snapshot } = build(rows);
    const study = find(facts, "Self study");
    expect(study.previous7Days).toBe("nothing logged");
    expect(study.change).toBe("nothing logged the week before");
    expect(study.readsAs).toBeNull();
    expect(snapshot.momentum).toBeNull();
    expect(snapshot.daysLogged).toBe(7);
  });
});

/**
 * The two things the coach could not see until the day they were added —
 * and the reason each is a correctness problem rather than a nicety: without
 * them the model reads a chosen day off as a collapse, and has no honest way
 * to answer "will I get there?".
 */
describe("what the coach can see about a rest day", () => {
  const RESTED = ["2026-08-09", "2026-08-10"];

  /** The same fortnight, with nothing logged on those two days. */
  const withGap = () => entries().filter((e) => !RESTED.includes(e.date));

  it("marks the days that were taken off on purpose", () => {
    const { facts } = build(withGap(), RESTED);
    const off = facts.last14Days.filter((d) => d.plannedRestDay);
    expect(off.map((d) => d.date)).toEqual(RESTED);
    expect(facts.plannedRestDays.count).toBe(2);
    expect(facts.plannedRestDays.days).toEqual(["Sunday 9 Aug", "Monday 10 Aug"]);
  });

  it("leaves an ordinary blank day unmarked — a gap is not a decision", () => {
    const { facts } = build(withGap(), []);
    expect(facts.last14Days.some((d) => d.plannedRestDay)).toBe(false);
    expect(facts.plannedRestDays.count).toBe(0);
  });

  it("keeps the logging run whole across them", () => {
    const rested = build(withGap(), RESTED);
    const abandoned = build(withGap(), []);
    // Same days logged either way — a flag can never add to a count...
    expect(rested.snapshot.daysLogged).toBe(abandoned.snapshot.daysLogged);
    // ...but the run the model is told about steps over the chosen days.
    expect(rested.facts.rightNow.loggingStreak).toBe(12);
    expect(abandoned.facts.rightNow.loggingStreak).toBe(4);
  });
});

describe("what the coach can see about a target", () => {
  const withTarget = (over: Partial<NonNullable<Tracker["target"]>> = {}) =>
    TRACKERS.map((t) =>
      t.id === "study"
        ? {
            ...t,
            target: {
              kind: "total" as const,
              value: 3600,
              by: "2026-09-14",
              from: "2026-08-01",
              ...over,
            },
          }
        : t
    );

  it("hands over the aim, the pace and the date it lands on", () => {
    const { facts } = build(entries(), [], withTarget());
    const study = find(facts, "Self study");
    expect(study.target).not.toBeNull();
    expect(study.target!.aim).toBe("add up to 60h by Monday 14 Sep");
    expect(study.target!.reached).toBe("21h");
    expect(study.target!.remaining).toBe("39h");
    // 21h over 14 days is 90 minutes a day; 2,340 minutes left is 26 days.
    expect(study.target!.atThisRate).toBe("Wednesday 9 Sep");
    expect(study.target!.readsAs).toBe("on track");
  });

  it("says a pace that misses the date misses it", () => {
    const { facts } = build(entries(), [], withTarget({ by: "2026-08-20" }));
    expect(find(facts, "Self study").target!.readsAs).toBe("behind");
  });

  it("refuses a date when nothing has moved", () => {
    const { facts } = build(
      entries().filter((e) => e.trackerId !== "study"),
      [],
      withTarget()
    );
    const study = find(facts, "Self study");
    expect(study.target!.atThisRate).toBeNull();
    expect(study.target!.readsAs).toBe("not moving");
  });

  it("is null on every tracker that isn't walking towards anything", () => {
    const { facts } = build(entries(), [], withTarget());
    expect(find(facts, "Junk food").target).toBeNull();
  });
});
