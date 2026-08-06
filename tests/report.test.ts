import { describe, expect, it } from "vitest";
import {
  buildReportCard,
  gradeLetter,
  reportLines,
  type ReportEntry,
  type ReportTracker,
} from "../lib/report";

const tracker = (over: Partial<ReportTracker> & { id: string }): ReportTracker => ({
  name: over.id,
  type: "check",
  category: "other",
  color: "#2a78d6",
  goal: null,
  archived: false,
  ...over,
});

/** One entry per day from `start`, `n` days long, all with `value`. */
function daily(trackerId: string, start: string, n: number, value = 1): ReportEntry[] {
  const out: ReportEntry[] = [];
  const [y, m, d] = start.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    const date = new Date(y, m - 1, d + i);
    const s = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    out.push({ trackerId, date: s, value });
  }
  return out;
}

describe("gradeLetter", () => {
  it("maps the scale", () => {
    expect(gradeLetter(0.95)).toBe("A+");
    expect(gradeLetter(0.85)).toBe("A");
    expect(gradeLetter(0.75)).toBe("B");
    expect(gradeLetter(0.6)).toBe("C");
    expect(gradeLetter(0.45)).toBe("D");
    expect(gradeLetter(0.2)).toBe("F");
  });
});

describe("buildReportCard", () => {
  it("has nothing to say about an empty account", () => {
    const r = buildReportCard([tracker({ id: "a" })], [], [], "2026-08-07");
    expect(r.hasData).toBe(false);
    expect(r.overall).toBeNull();
  });

  it("grades showing up when there's no goal", () => {
    // Logged 8 of the 10 days it has existed.
    const entries = [
      ...daily("a", "2026-07-29", 5),
      ...daily("a", "2026-08-04", 3),
    ];
    const r = buildReportCard([tracker({ id: "a" })], entries, [], "2026-08-07");
    const g = r.subjects[0].trackers[0];
    expect(g.basis).toBe("logging");
    expect(g.lifetime).toBe(10);
    expect(g.score).toBeCloseTo(0.8);
  });

  it("grades goal trackers on hit rate, unlogged days failing an at-least", () => {
    const t = tracker({
      id: "a",
      type: "duration",
      goal: { target: 60, period: "day", direction: "min" },
    });
    // 7-day life: 5 days over the bar, 1 under, 1 never logged.
    const entries = [
      ...daily("a", "2026-08-01", 5, 90),
      { trackerId: "a", date: "2026-08-06", value: 30 },
    ];
    const r = buildReportCard([t], entries, [], "2026-08-07");
    const g = r.subjects[0].trackers[0];
    expect(g.basis).toBe("goals");
    expect(g.score).toBeCloseTo(5 / 7);
  });

  it("grades streaks on clean days", () => {
    const t = tracker({ id: "a", type: "streak" });
    const entries = [
      ...daily("a", "2026-08-01", 6, 1),
      { trackerId: "a", date: "2026-08-07", value: 0 }, // a slip
    ];
    const r = buildReportCard([t], entries, [], "2026-08-07");
    const g = r.subjects[0].trackers[0];
    expect(g.basis).toBe("clean");
    expect(g.score).toBeCloseTo(6 / 7);
  });

  it("grades a bad habit on the days it didn't happen", () => {
    const t = tracker({ id: "junk", name: "Junk food", type: "count", habit: "bad" });
    // Happened on 3 days of a 10-day lifetime.
    const entries: ReportEntry[] = [
      { trackerId: "junk", date: "2026-07-29", value: 2 },
      { trackerId: "junk", date: "2026-08-02", value: 1 },
      { trackerId: "junk", date: "2026-08-05", value: 3 },
    ];
    const r = buildReportCard([t], entries, [], "2026-08-07");
    const g = r.subjects[0].trackers[0];
    expect(g.basis).toBe("clean");
    expect(g.score).toBeCloseTo(0.7); // 7 clean days of 10
  });

  it("won't judge a tracker younger than a week", () => {
    const r = buildReportCard(
      [tracker({ id: "a", name: "New thing" })],
      daily("a", "2026-08-05", 3),
      [],
      "2026-08-07"
    );
    expect(r.subjects).toHaveLength(0);
    expect(r.ungraded.map((u) => u.name)).toEqual(["New thing"]);
    expect(r.overall).toBeNull();
    // ...but its days still count on the record.
    expect(r.daysLogged).toBe(3);
  });

  it("counts archived history in the totals without grading it", () => {
    const kept = tracker({ id: "a", category: "study" });
    const shelved = tracker({ id: "b", archived: true, type: "duration" });
    const entries = [
      ...daily("a", "2026-07-01", 30),
      ...daily("b", "2026-07-01", 30, 60),
    ];
    const r = buildReportCard([kept, shelved], entries, [], "2026-08-07");
    expect(r.subjects).toHaveLength(1);
    expect(r.subjects[0].category).toBe("study");
    expect(r.timeMinutes).toBe(1800); // the archived duration still counts
  });

  it("finds the best and current logging streaks", () => {
    const entries = [
      ...daily("a", "2026-07-01", 10), // a 10-day run, then a gap
      ...daily("a", "2026-08-04", 3), // 4th–6th, today the 7th unlogged
    ];
    const r = buildReportCard([tracker({ id: "a" })], entries, [], "2026-08-07");
    expect(r.bestStreak).toBe(10);
    expect(r.currentStreak).toBe(3); // an unlogged today doesn't break it
    expect(r.firstDate).toBe("2026-07-01");
    expect(r.daysLogged).toBe(13);
  });

  it("sorts subjects weakest first and averages the overall", () => {
    const good = tracker({ id: "a", category: "faith" });
    const poor = tracker({ id: "b", category: "fitness" });
    const entries = [
      ...daily("a", "2026-07-29", 10), // 10/10
      ...daily("b", "2026-07-29", 5), // 5/10
    ];
    const r = buildReportCard([good, poor], entries, [], "2026-08-07");
    expect(r.subjects.map((s) => s.category)).toEqual(["fitness", "faith"]);
    expect(r.overall).toBeCloseTo(0.75);
  });

  it("writes motivation lines with the account's own numbers in them", () => {
    // A perfect 30-day account: A+ overall, on a 30-day run.
    const r = buildReportCard(
      [tracker({ id: "a", category: "study" })],
      daily("a", "2026-07-09", 30),
      [],
      "2026-08-07"
    );
    const lines = reportLines(r);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("A+"))).toBe(true);
    expect(lines.some((l) => l.includes("30 days into a logging run"))).toBe(true);

    // A struggling account still gets credit for showing up, and a target.
    const weak = buildReportCard(
      [tracker({ id: "a", category: "fitness" })],
      daily("a", "2026-07-09", 9), // 9 of 30 days
      [],
      "2026-08-07"
    );
    const weakLines = reportLines(weak);
    expect(weakLines.some((l) => l.includes("9 days you showed up"))).toBe(true);
    expect(weakLines.some((l) => l.includes("Fitness"))).toBe(true);

    // Nothing logged, nothing to say — the caller falls back to the pool.
    expect(reportLines(buildReportCard([], [], [], "2026-08-07"))).toEqual([]);
  });

  it("tallies challenges by how they ended", () => {
    const t = tracker({ id: "a" });
    const entries = daily("a", "2026-07-01", 7); // 1st–7th all done
    const challenges = [
      // Ended, every day met.
      { trackerId: "a", startDate: "2026-07-01", days: 7, target: null, direction: "min" as const },
      // Ended with misses.
      { trackerId: "a", startDate: "2026-07-05", days: 7, target: null, direction: "min" as const },
      // Still going.
      { trackerId: "a", startDate: "2026-08-01", days: 30, target: null, direction: "min" as const },
    ];
    const r = buildReportCard([t], entries, challenges, "2026-08-07");
    expect(r.challenges).toEqual({ total: 3, completed: 1, running: 1, fell: 1 });
  });
});
