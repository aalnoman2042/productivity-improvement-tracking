import { describe, expect, it } from "vitest";
import { RANKS, buildAwards, rankFor, type Standing } from "../lib/awards";
import type { ReportCard, ReportEntry, ReportTracker } from "../lib/report";

const standing = (over: Partial<Standing> = {}): Standing => ({
  daysLogged: 0,
  bestRun: 0,
  goalRate: 0,
  challengesDone: 0,
  ...over,
});

const report = (over: Partial<ReportCard> = {}): ReportCard => ({
  hasData: true,
  firstDate: "2026-01-01",
  spanDays: 240,
  daysLogged: 210,
  totalEntries: 900,
  bestStreak: 61,
  currentStreak: 12,
  timeMinutes: 30_000,
  subjects: [],
  overall: 0.72,
  ungraded: [],
  challenges: { total: 4, completed: 2, running: 1, fell: 1 },
  ...over,
});

const tracker = (over: Partial<ReportTracker> = {}): ReportTracker => ({
  id: "t1",
  name: "Study",
  type: "duration",
  category: "learning",
  color: "1",
  goal: null,
  archived: false,
  ...over,
});

describe("rankFor — earned, not averaged", () => {
  it("starts everybody at the bottom rung rather than at nothing", () => {
    expect(rankFor(standing()).name).toBe("Newcomer");
    expect(rankFor(standing()).step).toBe(0);
  });

  it("will not promote on one strong number alone", () => {
    // A thousand days logged, but never two weeks in a row and no goals kept.
    const r = rankFor(standing({ daysLogged: 1000 }));
    expect(r.name).toBe("Newcomer");
  });

  it("gives the highest rung whose every requirement holds", () => {
    expect(
      rankFor(
        standing({ daysLogged: 210, bestRun: 61, goalRate: 0.72, challengesDone: 2 })
      ).name
    ).toBe("Unbreakable");
  });

  it("names what is still missing, and only what is missing", () => {
    const r = rankFor(
      standing({ daysLogged: 100, bestRun: 30, goalRate: 0.61, challengesDone: 0 })
    );
    expect(r.name).toBe("Dedicated");
    expect(r.next?.name).toBe("Relentless");
    // The days, the run and the rate are all already there — one thing left.
    expect(r.next?.needs).toEqual(["1 more challenge finished"]);
  });

  it("counts the days that are actually short", () => {
    const r = rankFor(standing({ daysLogged: 10 }));
    expect(r.next?.needs).toContain("4 more days on the record");
  });

  it("has nothing left to ask for at the top", () => {
    const top = RANKS[RANKS.length - 1].need;
    expect(rankFor(top).name).toBe("Alpha");
    expect(rankFor(top).next).toBeNull();
  });
});

describe("buildAwards — the wall", () => {
  const entries: ReportEntry[] = [
    { trackerId: "t1", date: "2026-08-01", value: 120 },
    { trackerId: "t1", date: "2026-08-02", value: 300 },
    { trackerId: "t1", date: "2026-08-03", value: 300 },
    { trackerId: "t2", date: "2026-08-02", value: 5 },
    { trackerId: "t2", date: "2026-09-09", value: 9 },
  ];
  const trackers = [tracker(), tracker({ id: "t2", name: "Water", type: "count" })];

  it("keeps the date a record was FIRST set, not the last time it was equalled", () => {
    const a = buildAwards({ trackers, entries, report: report() });
    const study = a.bests.find((b) => b.trackerId === "t1");
    expect(study?.date).toBe("2026-08-02");
    expect(study?.value).toBe("5h");
  });

  it("finds the fullest day and the best month", () => {
    const a = buildAwards({ trackers, entries, report: report() });
    expect(a.fullestDay).toEqual({ date: "2026-08-02", count: 2, of: 2 });
    expect(a.bestMonth).toEqual({ month: "2026-08", days: 3 });
  });

  it("ignores zeroes for a personal best — but still counts the day", () => {
    // A streak slip is `value 0` WITH meta (invariant 2), and the projection
    // this route reads does not carry meta. So a zero row is a day that was
    // ANSWERED, and treating it as blank would have disagreed with the report
    // card's own days-logged sitting on the same screen.
    const a = buildAwards({
      trackers,
      entries: [{ trackerId: "t1", date: "2026-08-04", value: 0 }],
      report: report(),
    });
    expect(a.bests).toEqual([]);
    // `of` is 1, not 2: t2 has never been logged, so it was not something
    // being tracked on that day. See `expectedOn`.
    expect(a.fullestDay).toEqual({ date: "2026-08-04", count: 1, of: 1 });
    expect(a.bestMonth).toEqual({ month: "2026-08", days: 1 });
  });

  it("never counts an archived tracker's old rows towards a day's fullness", () => {
    // Archiving does not delete entries. Counting them against today's active
    // tracker list is how the card came to render an impossible "3/2".
    const a = buildAwards({
      trackers: [tracker(), tracker({ id: "gone", archived: true })],
      entries: [
        { trackerId: "t1", date: "2026-08-01", value: 60 },
        { trackerId: "gone", date: "2026-08-01", value: 60 },
      ],
      report: report(),
    });
    expect(a.fullestDay).toEqual({ date: "2026-08-01", count: 1, of: 1 });
    // ...and the ratio can never exceed one.
    expect(a.fullestDay?.count).toBeLessThanOrEqual(a.fullestDay?.of ?? 0);
  });

  it("does not hand Full house to a day carried by archived trackers", () => {
    const a = buildAwards({
      trackers: [
        tracker(),
        tracker({ id: "t2" }),
        tracker({ id: "old1", archived: true }),
        tracker({ id: "old2", archived: true }),
      ],
      entries: [
        // Both live trackers were in use from the 1st...
        { trackerId: "t1", date: "2026-08-01", value: 60 },
        { trackerId: "t2", date: "2026-08-01", value: 60 },
        // ...and on the 2nd only one of them was answered, while two
        // archived trackers were. Three rows, but the day is not complete.
        { trackerId: "t1", date: "2026-08-02", value: 60 },
        { trackerId: "old1", date: "2026-08-02", value: 60 },
        { trackerId: "old2", date: "2026-08-02", value: 60 },
      ],
      report: report(),
    });
    // The 1st is the full day, not the 2nd — archived rows count for nothing.
    expect(a.fullestDay).toEqual({ date: "2026-08-01", count: 2, of: 2 });
  });

  it("never lets a tracker added later un-complete a day already finished", () => {
    // The promise this page makes in its own header: an award is earned by
    // something that happened, and nothing later can take it back.
    const entries: ReportEntry[] = [
      { trackerId: "t1", date: "2026-08-01", value: 60 },
      { trackerId: "t2", date: "2026-08-01", value: 60 },
    ];
    const before = buildAwards({
      trackers: [tracker(), tracker({ id: "t2" })],
      entries,
      report: report(),
    });
    expect(before.awards.find((x) => x.id === "full-house")?.earned).toBe(true);

    // Now add a third tracker today and log nothing on it.
    const after = buildAwards({
      trackers: [tracker(), tracker({ id: "t2" }), tracker({ id: "t3" })],
      entries,
      report: report(),
    });
    expect(after.awards.find((x) => x.id === "full-house")?.earned).toBe(true);
  });

  it("a ratio on the card can never exceed one", () => {
    const a = buildAwards({
      trackers: [tracker(), tracker({ id: "gone", archived: true })],
      entries: [
        { trackerId: "t1", date: "2026-08-01", value: 60 },
        { trackerId: "gone", date: "2026-08-01", value: 60 },
      ],
      report: report(),
    });
    expect(a.fullestDay!.count).toBeLessThanOrEqual(a.fullestDay!.of);
  });

  it("gives a bad habit no best day — its maximum is its worst day", () => {
    const a = buildAwards({
      trackers: [tracker({ id: "junk", name: "Junk food", type: "count", habit: "bad" })],
      entries: [
        { trackerId: "junk", date: "2026-08-01", value: 2 },
        { trackerId: "junk", date: "2026-08-02", value: 9 },
      ],
      report: report(),
    });
    expect(a.bests).toEqual([]);
  });

  it("has no best day for the kinds that cannot have one", () => {
    const a = buildAwards({
      trackers: [tracker({ type: "check" }), tracker({ id: "t3", type: "streak" })],
      entries: [
        { trackerId: "t1", date: "2026-08-01", value: 1 },
        { trackerId: "t3", date: "2026-08-01", value: 1 },
      ],
      report: report(),
    });
    expect(a.bests).toEqual([]);
  });

  it("leaves an archived tracker off the wall", () => {
    const a = buildAwards({
      trackers: [tracker({ archived: true })],
      entries,
      report: report(),
    });
    expect(a.bests).toEqual([]);
  });

  it("does not hand out Full house to an account with no trackers", () => {
    const a = buildAwards({ trackers: [], entries: [], report: report() });
    const full = a.awards.find((x) => x.id === "full-house");
    expect(full?.earned).toBe(false);
    expect(full?.progress).toBe(0);
  });

  it("earns the run awards off the best run, not the current one", () => {
    const a = buildAwards({
      trackers,
      entries,
      report: report({ bestStreak: 31, currentStreak: 0 }),
    });
    expect(a.awards.find((x) => x.id === "iron-month")?.earned).toBe(true);
    expect(a.awards.find((x) => x.id === "unbroken-hundred")?.earned).toBe(false);
  });

  it("never reports more than complete progress on something exceeded", () => {
    const a = buildAwards({
      trackers,
      entries,
      report: report({ daysLogged: 4000 }),
    });
    for (const award of a.awards) expect(award.progress).toBeLessThanOrEqual(1);
  });

  it("survives an account with no challenges at all", () => {
    const a = buildAwards({
      trackers,
      entries,
      report: report({ challenges: null, overall: null }),
    });
    expect(a.standing.challengesDone).toBe(0);
    expect(a.standing.goalRate).toBe(0);
    // Still climbs: the first two rungs ask only for days and a run, so
    // somebody who has never set a goal is not pinned at the bottom for it.
    expect(a.rank.name).toBe("Consistent");
    expect(a.rank.next?.needs).toContain("50% of your goals kept");
  });
});
