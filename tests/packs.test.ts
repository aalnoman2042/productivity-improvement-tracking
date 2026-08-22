import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  TEMPLATE_PACKS,
  TEMPLATES,
  TRACKER_TYPES,
} from "../lib/trackers";

/**
 * The packs are data, and data with a typo in it fails at the database rather
 * than in the editor: an unknown category or a malformed colour is only
 * rejected by the BSON validator, at the moment someone taps "add pack" on a
 * real account. These are the checks that catch it here instead.
 */

const TYPES = new Set(TRACKER_TYPES.map((t) => t.value));
const KNOWN_CATEGORIES = new Set(CATEGORIES.map((c) => c.value));

describe("ready-made packs", () => {
  it("offers a set for each kind of person, all with distinct ids", () => {
    const ids = TEMPLATE_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("essentials");
    expect(ids).toContain("deen");
    expect(ids).toContain("gym");
    expect(ids).toContain("productive");
    expect(ids).toContain("learner");
  });

  it("keeps the essentials as the one-click starter set", () => {
    expect(TEMPLATES).toBe(TEMPLATE_PACKS[0].items);
    expect(TEMPLATE_PACKS[0].id).toBe("essentials");
  });

  for (const pack of TEMPLATE_PACKS) {
    describe(pack.id, () => {
      it("is described well enough to choose between", () => {
        expect(pack.label.length).toBeGreaterThan(2);
        expect(pack.hint.length).toBeGreaterThan(10);
        expect(pack.items.length).toBeGreaterThan(2);
      });

      it("names each tracker once — a pack can't create two of anything", () => {
        const names = pack.items.map((t) => t.name.toLowerCase());
        expect(new Set(names).size).toBe(names.length);
      });

      it("only uses types, categories and colours the database accepts", () => {
        for (const t of pack.items) {
          expect(TYPES.has(t.type)).toBe(true);
          expect(KNOWN_CATEGORIES.has(t.category)).toBe(true);
          expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
          expect(t.name.length).toBeLessThanOrEqual(60);
          expect(t.unit.length).toBeLessThanOrEqual(12);
        }
      });

      it("sets goals that point somewhere", () => {
        for (const t of pack.items) {
          if (!t.goal) continue;
          expect(t.goal.target).toBeGreaterThan(0);
          expect(["day", "week"]).toContain(t.goal.period);
          expect(["min", "max"]).toContain(t.goal.direction);
        }
      });

      it("marks anything worth cutting down as a bad habit", () => {
        for (const t of pack.items) {
          // The rule that makes the whole judgement system work: a tracker
          // you want *less* of must say so, or growth in it reads as progress.
          if (t.goal?.direction === "max") expect(t.habit).toBe("bad");
        }
      });
    });
  }
});
