import { describe, expect, it } from "vitest";
import { isBeyondToday } from "../lib/dates";

/**
 * The guard that makes the Tomorrow tab safe: the daily page may offer a
 * day before it starts, but only to plan it. Logging one is refused on the
 * server, where no client can edit the refusal out.
 */

describe("isBeyondToday", () => {
  const now = new Date("2026-08-23T12:00:00Z");

  it("allows today and everything behind it", () => {
    expect(isBeyondToday("2026-08-23", now)).toBe(false);
    expect(isBeyondToday("2026-08-22", now)).toBe(false);
    expect(isBeyondToday("2020-01-01", now)).toBe(false);
  });

  it("allows tomorrow, because somebody is already living it", () => {
    // UTC+14 is a real timezone with real users of nothing in particular;
    // refusing their evening's log would be a bug they could never explain.
    expect(isBeyondToday("2026-08-24", now)).toBe(false);
  });

  it("refuses a day nobody on Earth has reached", () => {
    expect(isBeyondToday("2026-08-25", now)).toBe(true);
    expect(isBeyondToday("2027-01-01", now)).toBe(true);
  });

  it("holds at the edges of a UTC day", () => {
    const midnight = new Date("2026-08-23T00:00:00Z");
    const lastMinute = new Date("2026-08-23T23:59:59Z");
    expect(isBeyondToday("2026-08-24", midnight)).toBe(false);
    expect(isBeyondToday("2026-08-25", lastMinute)).toBe(true);
  });

  it("crosses a month and a year without help", () => {
    expect(isBeyondToday("2026-09-01", new Date("2026-08-31T12:00:00Z"))).toBe(false);
    expect(isBeyondToday("2027-01-01", new Date("2026-12-31T12:00:00Z"))).toBe(false);
    expect(isBeyondToday("2027-01-02", new Date("2026-12-31T12:00:00Z"))).toBe(true);
  });
});
