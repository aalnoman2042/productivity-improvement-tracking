import { describe, expect, it } from "vitest";
import { parseMeta } from "../lib/entryMeta";

describe("parseMeta", () => {
  it("returns null for nothing worth storing", () => {
    expect(parseMeta(null)).toBeNull();
    expect(parseMeta("string")).toBeNull();
    expect(parseMeta({})).toBeNull();
    expect(parseMeta({ start: "", parts: [], status: null })).toBeNull();
  });

  it("keeps valid sleep times and drops malformed ones", () => {
    expect(parseMeta({ start: "23:30", end: "07:00" })).toEqual({
      start: "23:30",
      end: "07:00",
      quality: null,
      naps: null,
      parts: null,
      status: null,
    });
    // "7:00" isn't HH:MM as stored — the daily log always writes two digits.
    expect(parseMeta({ start: "7:00" })).toBeNull();
    expect(parseMeta({ start: "sleep o'clock" })).toBeNull();
  });

  it("clamps quality to a 1–5 integer or nothing", () => {
    expect(parseMeta({ quality: 4 })?.quality).toBe(4);
    expect(parseMeta({ quality: 4.6 })?.quality).toBe(5);
    expect(parseMeta({ quality: 0 })).toBeNull();
    expect(parseMeta({ quality: 9 })).toBeNull();
  });

  it("filters prayers to the real five, in prayer order", () => {
    expect(
      parseMeta({ parts: ["isha", "fajr", "brunch", 42, "fajr"] })?.parts
    ).toEqual(["fajr", "isha"]);
  });

  it("keeps naps that are real minutes and drops the rest", () => {
    expect(
      parseMeta({
        naps: [
          { mins: 30, at: "14:20" },
          { mins: 20 },
          { mins: 0 },
          { mins: 2000 },
          { mins: 15, at: "half two" },
          "nap",
        ],
      })?.naps
    ).toEqual([
      { mins: 30, at: "14:20" },
      { mins: 20, at: null },
      { mins: 15, at: null },
    ]);
  });

  it("a nap alone is worth storing", () => {
    expect(parseMeta({ naps: [{ mins: 45 }] })?.naps).toEqual([
      { mins: 45, at: null },
    ]);
    expect(parseMeta({ naps: [] })).toBeNull();
  });

  it("accepts only clean or slip as a status", () => {
    expect(parseMeta({ status: "slip" })?.status).toBe("slip");
    expect(parseMeta({ status: "clean" })?.status).toBe("clean");
    expect(parseMeta({ status: "maybe" })).toBeNull();
  });
});
