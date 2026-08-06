import { describe, expect, it } from "vitest";
import {
  DAY_MINUTES,
  EMPTY,
  dayTimeTotal,
  draftToEntry,
  isLogged,
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
