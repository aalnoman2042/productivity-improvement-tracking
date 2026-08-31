import { describe, expect, it } from "vitest";
import {
  DAY_MINUTES,
  EMPTY,
  dayTimeTotal,
  draftNote,
  draftToEntry,
  isLogged,
  slipNeedsReason,
  slipsMissingReason,
  timeSlices,
  toDraft,
} from "../lib/draft";
import type { Tracker } from "../lib/trackers";

describe("dayTimeTotal", () => {
  const t = (id: string, type: Tracker["type"]): Tracker => ({
    id,
    name: id,
    type,
    unit: "",
    color: "#2a78d6",
    category: "other",
    goal: null,
    archived: false,
    order: 0,
  });

  it("adds time spent and sleep, ignoring everything else", () => {
    const trackers = [t("work", "duration"), t("sleep", "sleep"), t("water", "count")];
    const draft = {
      work: { ...EMPTY, h: "10", m: "0" },
      sleep: { ...EMPTY, start: "23:00", end: "07:00" }, // 8h
      water: { ...EMPTY, num: "900" }, // not time — not counted
    };
    expect(dayTimeTotal(trackers, draft)).toBe(18 * 60);
  });

  it("a physically impossible day crosses DAY_MINUTES", () => {
    const trackers = [t("work", "duration"), t("sleep", "sleep")];
    const draft = {
      work: { ...EMPTY, h: "18", m: "0" },
      sleep: { ...EMPTY, start: "23:00", end: "07:00" },
    };
    expect(dayTimeTotal(trackers, draft)).toBeGreaterThan(DAY_MINUTES);
  });
});

describe("draftToEntry", () => {
  it("turns hours and minutes into minutes", () => {
    expect(draftToEntry("duration", { ...EMPTY, h: "2", m: "30" }).value).toBe(150);
    expect(draftToEntry("duration", { ...EMPTY, m: "45" }).value).toBe(45);
    expect(draftToEntry("duration", EMPTY).value).toBe(0);
  });

  it("computes sleep across midnight", () => {
    const e = draftToEntry("sleep", { ...EMPTY, start: "23:30", end: "07:00" });
    expect(e.value).toBe(450);
    expect(e.meta).toEqual({ start: "23:30", end: "07:00", quality: null });
  });

  it("keeps a half-filled night as meta with no value", () => {
    const e = draftToEntry("sleep", { ...EMPTY, start: "23:30" });
    expect(e.value).toBe(0);
    expect(e.meta).toEqual({ start: "23:30", end: null, quality: null });
  });

  it("counts prayers and keeps which ones", () => {
    const e = draftToEntry("prayer", { ...EMPTY, parts: ["isha", "fajr"] });
    expect(e.value).toBe(2);
    // Stored in prayer order, not tap order.
    expect(e.meta).toEqual({ parts: ["fajr", "isha"] });
  });

  it("stores a slip as value 0 WITH meta — distinct from a blank day", () => {
    const slip = draftToEntry("streak", { ...EMPTY, status: "slip" });
    expect(slip).toEqual({ value: 0, meta: { status: "slip" } });
    const blank = draftToEntry("streak", EMPTY);
    expect(blank).toEqual({ value: 0, meta: null });
  });
});

describe("isLogged", () => {
  it("calls a slip logged and a blank day not", () => {
    expect(isLogged("streak", { ...EMPTY, status: "slip" })).toBe(true);
    expect(isLogged("streak", EMPTY)).toBe(false);
  });

  it("calls an unchecked check not logged", () => {
    expect(isLogged("check", { ...EMPTY, checked: false })).toBe(false);
    expect(isLogged("check", { ...EMPTY, checked: true })).toBe(true);
  });
});

describe("toDraft ↔ draftToEntry round trip", () => {
  it("survives for a duration", () => {
    const entry = { trackerId: "x", value: 150, meta: null };
    const draft = toDraft("duration", entry);
    expect(draftToEntry("duration", draft).value).toBe(150);
  });

  it("reads old streak entries that pre-date the status field", () => {
    expect(toDraft("streak", { trackerId: "x", value: 1, meta: null }).status).toBe("clean");
    expect(toDraft("streak", { trackerId: "x", value: 0, meta: null }).status).toBe("slip");
  });
});

describe("notes on an entry", () => {
  it("comes back out of a stored entry, whatever kind it is", () => {
    expect(
      toDraft("duration", { trackerId: "t", value: 90, meta: null, note: "hard going" })
        .note
    ).toBe("hard going");
    expect(
      toDraft("sleep", {
        trackerId: "t",
        value: 480,
        meta: { start: "23:00", end: "07:00" },
        note: "woke twice",
      }).note
    ).toBe("woke twice");
    expect(
      toDraft("streak", {
        trackerId: "t",
        value: 0,
        meta: { status: "slip" },
        note: "long day",
      }).note
    ).toBe("long day");
  });

  it("is empty for a row that never had one, including old cached rows", () => {
    expect(toDraft("count", { trackerId: "t", value: 3, meta: null }).note).toBe("");
    expect(toDraft("count", undefined).note).toBe("");
  });

  it("sends nothing rather than an empty string", () => {
    expect(draftNote({ ...EMPTY, note: "   " })).toBeNull();
    expect(draftNote(undefined)).toBeNull();
    expect(draftNote({ ...EMPTY, note: "  finished ch.4 " })).toBe("finished ch.4");
  });

  it("a note alone does not make a day logged — it rides on what is", () => {
    expect(isLogged("count", { ...EMPTY, note: "meant to" })).toBe(false);
    expect(isLogged("count", { ...EMPTY, num: "2", note: "meant to" })).toBe(true);
  });
});

describe("timeSlices", () => {
  const t = (id: string, type: Tracker["type"], color = "#2a78d6"): Tracker => ({
    id,
    name: id,
    type,
    unit: "",
    color,
    category: "other",
    goal: null,
    archived: false,
    order: 0,
  });

  const trackers = [
    t("work", "duration"),
    t("water", "count"),
    t("sleep", "sleep"),
    t("gym", "duration"),
  ];

  it("keeps only the minute-counted trackers, in the order given", () => {
    const draft = {
      work: { ...EMPTY, h: "6", m: "30" },
      water: { ...EMPTY, num: "8" },
      sleep: { ...EMPTY, start: "23:00", end: "07:00" },
      gym: { ...EMPTY, h: "1", m: "0" },
    };
    expect(timeSlices(trackers, draft).map((s) => [s.id, s.minutes])).toEqual([
      ["work", 390],
      ["sleep", 480],
      ["gym", 60],
    ]);
  });

  it("leaves out the rows with nothing in them — an empty row is not a slice", () => {
    const draft = { work: { ...EMPTY, h: "2", m: "0" } };
    expect(timeSlices(trackers, draft)).toHaveLength(1);
    expect(timeSlices(trackers, {})).toEqual([]);
  });

  it("adds up to the same total the 24h cap is judged against", () => {
    const draft = {
      work: { ...EMPTY, h: "6", m: "30" },
      sleep: { ...EMPTY, start: "23:00", end: "07:00" },
    };
    const sum = timeSlices(trackers, draft).reduce((n, s) => n + s.minutes, 0);
    expect(sum).toBe(dayTimeTotal(trackers, draft));
    expect(sum).toBeLessThan(DAY_MINUTES);
  });
});

/**
 * A slip that hasn't said why yet.
 *
 * Drives the outline on the reason box and the line on the daily page —
 * an ask, never a gate. `tests/routes.entries.test.ts` holds the other half
 * of the rule: the server records a note-less slip regardless.
 */
describe("slipNeedsReason", () => {
  const streak = (over: Partial<Tracker> = {}): Tracker => ({
    id: "clean",
    name: "No smoking",
    type: "streak",
    unit: "",
    color: "#2a78d6",
    category: "other",
    goal: null,
    archived: false,
    order: 0,
    ...over,
  });

  it("spots a slip with nothing written on it", () => {
    expect(slipNeedsReason("streak", { ...EMPTY, status: "slip" })).toBe(true);
    expect(
      slipNeedsReason("streak", { ...EMPTY, status: "slip", note: "   " })
    ).toBe(true);
    expect(
      slipNeedsReason("streak", { ...EMPTY, status: "slip", note: "argument" })
    ).toBe(false);
  });

  it("asks nothing of a clean day, or of an untouched one", () => {
    expect(slipNeedsReason("streak", { ...EMPTY, status: "clean" })).toBe(false);
    expect(slipNeedsReason("streak", EMPTY)).toBe(false);
    expect(slipNeedsReason("streak", undefined)).toBe(false);
  });

  it("asks nothing of any other kind of tracker", () => {
    // Nothing else in the app is mandatory, and a zero elsewhere is not a
    // confession — it is just a quiet day.
    expect(slipNeedsReason("check", { ...EMPTY, status: "slip" })).toBe(false);
    expect(slipNeedsReason("count", { ...EMPTY, num: "0" })).toBe(false);
  });

  it("names the ones a day is waiting on", () => {
    const trackers = [
      streak({ id: "a", name: "No smoking" }),
      streak({ id: "b", name: "No scrolling" }),
      streak({ id: "c", name: "No sugar" }),
    ];
    const draft = {
      a: { ...EMPTY, status: "slip" as const },
      b: { ...EMPTY, status: "slip" as const, note: "bored" },
      c: { ...EMPTY, status: "clean" as const },
    };
    expect(slipsMissingReason(trackers, draft).map((t) => t.name)).toEqual([
      "No smoking",
    ]);
  });
});
