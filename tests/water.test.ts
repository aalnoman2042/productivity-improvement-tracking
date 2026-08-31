import { describe, expect, it } from "vitest";
import {
  GLASS_ML,
  formatMl,
  looksLikeWater,
  waterLine,
  waterNeed,
} from "../lib/water";

/**
 * The water goal, worked out rather than guessed.
 *
 * The numbers below are checked against the quick-reference table this was
 * built from — 30–35 ml per kg, and a single figure per weight taken at the
 * top of that band. If a change here moves 70 kg away from ~2.45 L, the
 * change is wrong, not the test.
 */

describe("waterNeed", () => {
  it("matches the reference table for a still day", () => {
    expect(waterNeed(50, "still")?.ml).toBe(1750);
    expect(waterNeed(60, "still")?.ml).toBe(2100);
    expect(waterNeed(70, "still")?.ml).toBe(2450);
    expect(waterNeed(80, "still")?.ml).toBe(2800);
    expect(waterNeed(90, "still")?.ml).toBe(3150);
  });

  it("reports the whole band, not just the number it picked from it", () => {
    // Showing 2.1–2.45 L is what stops the single figure reading as a law.
    expect(waterNeed(70, "still")?.bandMl).toEqual([2100, 2450]);
  });

  it("adds an allowance for sweat", () => {
    const still = waterNeed(70, "still")!;
    const moderate = waterNeed(70, "moderate")!;
    const hard = waterNeed(70, "hard")!;
    expect(moderate.ml - still.ml).toBe(425);
    expect(hard.ml - still.ml).toBe(800);
  });

  it("turns millilitres into glasses of a stated size", () => {
    const need = waterNeed(70, "still")!;
    expect(GLASS_ML).toBe(400);
    expect(need.glasses).toBe(Math.round(need.ml / GLASS_ML));
    expect(need.glasses).toBe(6);
    expect(waterNeed(90, "hard")!.glasses).toBe(10);
  });

  it("never asks for less than one glass", () => {
    expect(waterNeed(20, "still")!.glasses).toBeGreaterThanOrEqual(1);
  });

  it("says how much arrives in food, so a near miss isn't a failure", () => {
    const need = waterNeed(70, "still")!;
    expect(need.fromFoodMl).toBe(500); // ~20% of 2450, to the nearest 50
  });

  it("refuses a weight that isn't one", () => {
    expect(waterNeed(NaN, "still")).toBeNull();
    expect(waterNeed(0, "still")).toBeNull();
    expect(waterNeed(-70, "still")).toBeNull();
    // A misread of pounds, or a typo. Better to ask again than to prescribe
    // fourteen litres.
    expect(waterNeed(500, "still")).toBeNull();
    expect(waterNeed(15, "still")).toBeNull();
  });
});

describe("formatMl", () => {
  it("switches to litres where a person would", () => {
    expect(formatMl(425)).toBe("425 ml");
    expect(formatMl(2450)).toBe("2.45 L");
    expect(formatMl(3000)).toBe("3 L");
    expect(formatMl(1000)).toBe("1 L");
  });
});

describe("waterLine", () => {
  it("shows its working, including the glass size", () => {
    const line = waterLine(waterNeed(70, "moderate")!);
    expect(line).toContain("70 kg");
    expect(line).toContain("35 ml");
    expect(line).toContain("425 ml");
    expect(line).toContain("400 ml");
  });
});

describe("looksLikeWater", () => {
  it("spots the water tracker by name or by unit", () => {
    expect(looksLikeWater("Water", "glasses")).toBe(true);
    expect(looksLikeWater("Drinking water", "×")).toBe(true);
    expect(looksLikeWater("Hydration", "")).toBe(true);
    expect(looksLikeWater("Morning drink", "glasses")).toBe(true);
  });

  it("leaves every other counted thing alone", () => {
    // A wrong guess here only ever shows a button nobody presses — but a
    // cigarette tracker offering to work out a hydration goal would be
    // absurd enough to notice.
    expect(looksLikeWater("Cigarettes", "×")).toBe(false);
    expect(looksLikeWater("Meals", "meals")).toBe(false);
    expect(looksLikeWater("Watermelon", "×")).toBe(false);
  });
});
