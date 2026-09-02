import { describe, expect, it } from "vitest";
import {
  ROLES,
  buildMap,
  cleanOverrides,
  guessRoles,
  hasRole,
  mergeRoles,
  missingRoles,
  roleCoverage,
  scoreFit,
  signatureOf,
  trackerFor,
  trackersFor,
  type Assignment,
} from "../lib/trackerRoles";
import { deserializeAi, parseRoleAnswer, serializeAi } from "../lib/roleAI";
import type { Tracker } from "../lib/trackers";

/**
 * Detection is a guess with consequences: a tracker read as the wrong thing
 * moves hours between two numbers on a page about somebody's body. So these
 * are the checks that keep it honest — that the vocabulary people actually
 * use is understood, that one tracker never fills two roles, that a missing
 * role costs coverage rather than scoring as a perfect day, and that nothing
 * a model says can put a rating where a volume belongs.
 */

const tracker = (over: Partial<Tracker> & { id: string; name: string }): Tracker => ({
  type: "count",
  unit: "",
  color: "#123456",
  category: "other",
  goal: null,
  archived: false,
  order: 0,
  ...over,
});

const roleOf = (list: Assignment[], id: string) =>
  list.find((a) => a.trackerId === id)?.role ?? null;

describe("guessRoles — the vocabulary people actually use", () => {
  it("finds water however it is spelled", () => {
    for (const name of ["Water", "Hydration", "Water intake", "Drink water", "পানি"]) {
      const found = guessRoles([
        tracker({ id: "w", name, type: "count", category: "food", unit: "glasses" }),
      ]);
      expect(roleOf(found, "w"), name).toBe("water");
    }
  });

  it("finds junk food however it is spelled", () => {
    for (const name of ["Junk food", "Bad food", "Cheat meals", "Fast food", "Sugar"]) {
      const found = guessRoles([
        tracker({ id: "j", name, type: "count", category: "food", habit: "bad" }),
      ]);
      expect(roleOf(found, "j"), name).toBe("junk");
    }
  });

  it("reads desk work of every description as sitting", () => {
    for (const name of ["Tuition", "Tution", "Video editing", "Reading", "Coding", "Office work"]) {
      const found = guessRoles([
        tracker({ id: "s", name, type: "duration", category: "study" }),
      ]);
      expect(roleOf(found, "s"), name).toBe("sitting");
    }
  });

  it("separates entertainment screens from work screens", () => {
    const found = guessRoles([
      tracker({ id: "work", name: "Client work", type: "duration", category: "work" }),
      tracker({ id: "phone", name: "Doomscrolling", type: "duration", category: "discipline" }),
    ]);
    expect(roleOf(found, "work")).toBe("sitting");
    expect(roleOf(found, "phone")).toBe("screen");
  });

  it("uses the habit flag to tell junk from water, which the name alone cannot", () => {
    // Both are counts in Food with a drink-ish name. Only the flag says which
    // direction is winning, which is exactly why the flag exists.
    const found = guessRoles([
      tracker({ id: "good", name: "Drinks", type: "count", category: "food" }),
      tracker({ id: "bad", name: "Sugary drinks", type: "count", category: "food", habit: "bad" }),
    ]);
    expect(roleOf(found, "good")).toBe("water");
    expect(roleOf(found, "bad")).toBe("junk");
  });

  it("takes the type as conclusive where only one type can mean it", () => {
    const found = guessRoles([
      tracker({ id: "s", name: "Rest", type: "sleep", category: "sleep" }),
      tracker({ id: "c", name: "Staying on track", type: "streak", category: "discipline" }),
      tracker({ id: "p", name: "Salah", type: "prayer", category: "faith" }),
    ]);
    expect(roleOf(found, "s")).toBe("sleep");
    expect(roleOf(found, "c")).toBe("clean");
    expect(roleOf(found, "p")).toBe("prayer");
  });

  it("never gives one tracker two roles", () => {
    // "Reading" is a plausible claim for more than one role. Whichever wins,
    // it wins once — counting an hour twice is two hours that never happened.
    const found = guessRoles([
      tracker({ id: "r", name: "Reading books", type: "duration", category: "study" }),
    ]);
    expect(found.filter((a) => a.trackerId === "r")).toHaveLength(1);
  });

  it("gives a single-tracker role to exactly one tracker", () => {
    const found = guessRoles([
      tracker({ id: "a", name: "Water", type: "count", category: "food", unit: "glasses" }),
      tracker({ id: "b", name: "Hydration", type: "count", category: "food", unit: "glasses" }),
    ]);
    expect(found.filter((a) => a.role === "water")).toHaveLength(1);
  });

  it("lets several trackers fill a many-role", () => {
    const found = guessRoles([
      tracker({ id: "a", name: "Gym", type: "duration", category: "fitness" }),
      tracker({ id: "b", name: "Running", type: "duration", category: "fitness" }),
    ]);
    expect(found.filter((a) => a.role === "exercise")).toHaveLength(2);
  });

  it("ignores archived trackers", () => {
    const found = guessRoles([
      tracker({ id: "old", name: "Water", type: "count", category: "food", archived: true }),
    ]);
    expect(found).toHaveLength(0);
  });

  it("refuses a role whose type does not fit, however the name reads", () => {
    // A 1-5 rating called "Water" is not a count of glasses.
    const rating = tracker({ id: "w", name: "Water", type: "scale", category: "food" });
    const water = ROLES.find((r) => r.id === "water")!;
    expect(scoreFit(rating, water)).toBe(0);
  });
});

describe("mergeRoles — rules, then AI, then you", () => {
  const ai = (trackerId: string, role: Assignment["role"]): Assignment => ({
    trackerId,
    role,
    source: "ai",
    confidence: 0.9,
    why: "read from the name",
  });
  const rule = (
    trackerId: string,
    role: Assignment["role"],
    confidence: number
  ): Assignment => ({ trackerId, role, source: "rule", confidence, why: "matched" });

  it("lets a manual choice beat both", () => {
    const merged = mergeRoles(
      [rule("t", "screen", 1)],
      [ai("t", "sitting")],
      [{ trackerId: "t", role: "exercise", source: "manual", confidence: 1, why: "you set this" }]
    );
    expect(roleOf(merged, "t")).toBe("exercise");
  });

  it("keeps a confident rule over the AI", () => {
    const merged = mergeRoles([rule("t", "water", 0.9)], [ai("t", "junk")], []);
    expect(roleOf(merged, "t")).toBe("water");
  });

  it("lets the AI correct a rule the rules were unsure of", () => {
    const merged = mergeRoles([rule("t", "water", 0.45)], [ai("t", "junk")], []);
    expect(roleOf(merged, "t")).toBe("junk");
  });

  it("lets the AI fill a role the rules missed entirely", () => {
    const merged = mergeRoles([], [ai("t", "sitting")], []);
    expect(roleOf(merged, "t")).toBe("sitting");
  });
});

describe("buildMap — overrides and muting", () => {
  const trackers = [
    tracker({ id: "s", name: "Sleep", type: "sleep", category: "sleep" }),
    tracker({ id: "w", name: "Water", type: "count", category: "food", unit: "glasses" }),
  ];

  it("mutes a tracker the reader says fills nothing, and leaves the role empty", () => {
    const map = buildMap(trackers, [], { w: null });
    expect(trackerFor(map, "water")).toBeNull();
    // The point of muting: the role reads as missing rather than as filled by
    // something the reader has said is not that.
    expect(hasRole(map, "water")).toBe(false);
  });

  it("honours a manual role", () => {
    const map = buildMap(trackers, [], { w: "caffeine" });
    expect(trackerFor(map, "caffeine")).toBe("w");
    expect(trackerFor(map, "water")).toBeNull();
  });

  it("drops overrides for trackers that no longer exist", () => {
    expect(cleanOverrides({ gone: "water", w: "junk" }, trackers)).toEqual({ w: "junk" });
  });

  it("keeps the override on a tracker that was archived rather than deleted", () => {
    // The override map is written back wholesale on every change, so dropping
    // archived entries here would permanently erase a label somebody set on a
    // tracker they later retired — and un-archiving would hand it silently
    // back to the guesser.
    const withArchived = [
      ...trackers,
      tracker({ id: "old", name: "Old water", type: "count", archived: true }),
    ];
    expect(cleanOverrides({ old: "water", w: "junk" }, withArchived)).toEqual({
      old: "water",
      w: "junk",
    });
    // It still fills nothing while it is archived.
    const map = buildMap(withArchived, [], { old: "water" });
    expect(trackerFor(map, "water")).not.toBe("old");
  });

  it("drops an override naming a role that does not exist", () => {
    expect(cleanOverrides({ w: "telepathy" }, trackers)).toEqual({});
  });
});

describe("signatureOf — when the AI is worth re-running", () => {
  const base = [tracker({ id: "a", name: "Water", type: "count", category: "food" })];

  it("does not change when something the matcher never reads changes", () => {
    const recoloured = [{ ...base[0], color: "#ffffff", order: 9 }];
    expect(signatureOf(recoloured)).toBe(signatureOf(base));
  });

  it("changes when a name changes", () => {
    expect(signatureOf([{ ...base[0], name: "Hydration" }])).not.toBe(signatureOf(base));
  });

  it("changes when the habit flag flips", () => {
    expect(signatureOf([{ ...base[0], habit: "bad" }])).not.toBe(signatureOf(base));
  });
});

describe("coverage — a role nothing fills is missing, never fine", () => {
  it("reports every unfilled role and orders the pushy ones first", () => {
    const map = buildMap(
      [tracker({ id: "s", name: "Sleep", type: "sleep", category: "sleep" })],
      [],
      {}
    );
    const missing = missingRoles(map);
    expect(missing.some((r) => r.role === "sleep")).toBe(false);
    expect(missing.some((r) => r.role === "water")).toBe(true);
    // Private ones are offered, never pushed — they sort last.
    const quietAt = missing.findIndex((r) => r.quiet);
    const loudAt = missing.findIndex((r) => !r.quiet);
    expect(loudAt).toBeLessThan(quietAt);
  });

  it("rises as roles are filled and never reaches 100 on one tracker", () => {
    const one = buildMap(
      [tracker({ id: "s", name: "Sleep", type: "sleep", category: "sleep" })],
      [],
      {}
    );
    const two = buildMap(
      [
        tracker({ id: "s", name: "Sleep", type: "sleep", category: "sleep" }),
        tracker({ id: "w", name: "Water", type: "count", category: "food", unit: "glasses" }),
      ],
      [],
      {}
    );
    expect(roleCoverage(two)).toBeGreaterThan(roleCoverage(one));
    expect(roleCoverage(one)).toBeLessThan(100);
  });

  it("is zero when nothing is tracked", () => {
    expect(roleCoverage(buildMap([], [], {}))).toBe(0);
  });
});

describe("parseRoleAnswer — nothing the model says is taken on trust", () => {
  const trackers = [
    tracker({ id: "a", name: "Baje khabar", type: "count", category: "food", habit: "bad" }),
    tracker({ id: "b", name: "Mood", type: "scale", category: "health" }),
  ];

  const answer = (roles: unknown) => JSON.stringify({ roles });

  it("accepts a well-formed answer", () => {
    const found = parseRoleAnswer(
      answer([{ id: "a", role: "junk", confidence: 0.9, why: "bengali for bad food" }]),
      trackers
    );
    expect(found).toHaveLength(1);
    expect(found[0].role).toBe("junk");
    expect(found[0].source).toBe("ai");
  });

  it("drops a tracker id that was never sent", () => {
    expect(parseRoleAnswer(answer([{ id: "ghost", role: "junk" }]), trackers)).toHaveLength(0);
  });

  it("drops a role that does not exist", () => {
    expect(parseRoleAnswer(answer([{ id: "a", role: "vibes" }]), trackers)).toHaveLength(0);
  });

  it("drops a role the tracker's type cannot fill", () => {
    // A 1-5 mood scale labelled as a body weight is the failure mode that
    // would put a rating where a measurement belongs.
    expect(
      parseRoleAnswer(answer([{ id: "b", role: "weight", confidence: 1 }]), trackers)
    ).toHaveLength(0);
  });

  it("drops an answer below the confidence floor", () => {
    expect(
      parseRoleAnswer(answer([{ id: "a", role: "junk", confidence: 0.2 }]), trackers)
    ).toHaveLength(0);
  });

  it("never assigns the same tracker twice", () => {
    const found = parseRoleAnswer(
      answer([
        { id: "a", role: "junk", confidence: 0.9 },
        { id: "a", role: "water", confidence: 0.9 },
      ]),
      trackers
    );
    expect(found).toHaveLength(1);
  });

  it("returns nothing for malformed JSON rather than throwing", () => {
    expect(parseRoleAnswer("not json at all", trackers)).toEqual([]);
    expect(parseRoleAnswer("{}", trackers)).toEqual([]);
  });

  it("survives a round trip through storage", () => {
    const found = parseRoleAnswer(
      answer([{ id: "a", role: "junk", confidence: 0.8, why: "bad food" }]),
      trackers
    );
    expect(deserializeAi(serializeAi(found))).toEqual(found);
  });

  it("reads nothing out of stored rubbish", () => {
    expect(deserializeAi(null)).toEqual([]);
    expect(deserializeAi([{ trackerId: "a", role: "nonsense" }])).toEqual([]);
  });
});

describe("the role table itself", () => {
  it("has unique ids", () => {
    const ids = ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every role something to say when it is missing", () => {
    for (const role of ROLES) {
      expect(role.suggest.title.length, role.id).toBeGreaterThan(0);
      expect(role.suggest.why.length, role.id).toBeGreaterThan(20);
      expect(role.weight, role.id).toBeGreaterThanOrEqual(0);
    }
  });

  it("only lets a role claim coverage if something actually reads it", () => {
    // The coverage bar is labelled "feeding the numbers above". A role that
    // is detected but read by nothing must weigh zero, or the bar rises when
    // somebody adds a tracker that changes not one figure on the page.
    const FEEDS_NOTHING_YET = ["prayer"];
    for (const role of ROLES) {
      if (FEEDS_NOTHING_YET.includes(role.id)) {
        expect(role.weight, role.id).toBe(0);
        // ...and it must not be pushed at anybody either.
        expect(role.quiet, role.id).toBe(true);
      } else {
        expect(role.weight, role.id).toBeGreaterThan(0);
      }
    }
  });

  it("leaves a zero-weight role out of the coverage sum entirely", () => {
    const withPrayer = buildMap(
      [
        tracker({ id: "s", name: "Sleep", type: "sleep", category: "sleep" }),
        tracker({ id: "p", name: "Namaz", type: "prayer", category: "faith" }),
      ],
      [],
      {}
    );
    const without = buildMap(
      [tracker({ id: "s", name: "Sleep", type: "sleep", category: "sleep" })],
      [],
      {}
    );
    expect(roleCoverage(withPrayer)).toBe(roleCoverage(without));
  });

  it("keeps sleep the heaviest, because the whole page hangs off it", () => {
    const heaviest = [...ROLES].sort((a, b) => b.weight - a.weight)[0];
    expect(heaviest.id).toBe("sleep");
  });

  it("finds nothing at all in an empty tracker list", () => {
    const map = buildMap([], [], {});
    expect(map.assignments).toEqual([]);
    expect(trackersFor(map, "sleep")).toEqual([]);
  });
});
