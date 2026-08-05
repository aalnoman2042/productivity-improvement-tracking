import { describe, expect, it } from "vitest";
import { crossedRecently, reached } from "../lib/milestones";

describe("reached", () => {
  it("is the highest milestone at or below the count", () => {
    expect(reached(0)).toBeNull();
    expect(reached(6)).toBeNull();
    expect(reached(7)).toBe(7);
    expect(reached(29)).toBe(7);
    expect(reached(30)).toBe(30);
    expect(reached(400)).toBe(365);
  });
});

describe("crossedRecently", () => {
  it("finds a milestone crossed inside the window", () => {
    expect(crossedRecently(7)).toBe(7);
    expect(crossedRecently(13)).toBe(7);
    expect(crossedRecently(32)).toBe(30);
    expect(crossedRecently(100)).toBe(100);
  });

  it("stays quiet between milestones", () => {
    expect(crossedRecently(6)).toBeNull();
    expect(crossedRecently(14)).toBeNull();
    expect(crossedRecently(45)).toBeNull();
    expect(crossedRecently(200)).toBeNull();
  });
});
