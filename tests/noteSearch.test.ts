import { describe, expect, it } from "vitest";
import {
  escapeRegex,
  normalizeQuery,
  snippet,
  sortHits,
  type NoteHit,
} from "../lib/noteSearch";

describe("normalizeQuery", () => {
  it("takes a real query and trims it", () => {
    expect(normalizeQuery("  migraine  ")).toBe("migraine");
  });

  it("refuses what would match everything", () => {
    expect(normalizeQuery("a")).toBeNull();
    expect(normalizeQuery("   ")).toBeNull();
    expect(normalizeQuery("")).toBeNull();
    expect(normalizeQuery(null)).toBeNull();
    expect(normalizeQuery(42)).toBeNull();
  });

  it("bounds a query nobody typed by hand", () => {
    expect(normalizeQuery("x".repeat(500))).toHaveLength(80);
  });
});

describe("escapeRegex", () => {
  it("makes a typed query mean itself", () => {
    const q = escapeRegex("why(?)");
    expect(new RegExp(q, "i").test("asked why(?) again")).toBe(true);
    expect(new RegExp(q, "i").test("asked why again")).toBe(false);
  });

  it("defuses the patterns that would otherwise run away", () => {
    // A search box is not a regex console: "(a+)+$" must be five characters
    // to look for, not a pattern that can hang the server on a long note.
    const q = escapeRegex("(a+)+$");
    expect(new RegExp(q).test("(a+)+$")).toBe(true);
    expect(new RegExp(q).test("aaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });

  it("leaves ordinary words alone", () => {
    expect(escapeRegex("slept badly")).toBe("slept badly");
  });
});

describe("snippet", () => {
  it("returns a short note whole", () => {
    expect(snippet("woke twice", "woke")).toBe("woke twice");
  });

  it("cuts a long note down to the part that matched", () => {
    const long = `${"filler ".repeat(60)}the migraine came back ${"filler ".repeat(60)}`;
    const out = snippet(long, "migraine");
    expect(out).toContain("migraine");
    expect(out.length).toBeLessThan(long.length);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not mark an edge it did not cut", () => {
    const text = `the migraine came back ${"filler ".repeat(60)}`;
    const out = snippet(text, "migraine");
    expect(out.startsWith("…")).toBe(false);
    expect(out.endsWith("…")).toBe(true);
  });

  it("matches without caring about case", () => {
    const long = `${"filler ".repeat(60)}Ramadan starts ${"filler ".repeat(60)}`;
    expect(snippet(long, "ramadan")).toContain("Ramadan");
  });

  it("falls back to the whole note when the match isn't in the text", () => {
    // The server found this row; a snippet is a courtesy, not a second filter.
    expect(snippet("short one", "absent")).toBe("short one");
  });
});

describe("sortHits", () => {
  const hits: NoteHit[] = [
    { date: "2026-08-01", tracker: "Sleep", text: "a" },
    { date: "2026-08-20", tracker: null, text: "b" },
    { date: "2026-08-20", tracker: "Study", text: "c" },
    { date: "2026-08-20", tracker: "Namaz", text: "d" },
  ];

  it("puts the newest day first", () => {
    expect(sortHits(hits)[0].date).toBe("2026-08-20");
    expect(sortHits(hits).at(-1)?.date).toBe("2026-08-01");
  });

  it("leads each day with the day's own note", () => {
    const day = sortHits(hits).filter((h) => h.date === "2026-08-20");
    expect(day[0].tracker).toBeNull();
    expect(day.slice(1).map((h) => h.tracker)).toEqual(["Namaz", "Study"]);
  });

  it("leaves the caller's array alone", () => {
    const copy = [...hits];
    sortHits(hits);
    expect(hits).toEqual(copy);
  });
});
