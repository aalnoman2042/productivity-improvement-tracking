/**
 * How much water a body actually needs, and how many glasses that is.
 *
 * A water tracker shipped with a goal of "8 glasses" because eight is the
 * number everyone has heard. It is also a number nobody checked: eight
 * glasses is right for somebody, and for a 55kg person who sits in air
 * conditioning it is too much, and for a 95kg person who trains in Dhaka in
 * June it is not nearly enough. The rule of thumb that *does* scale is
 * **30–35 ml per kilogram of body weight per day**, and this file is that
 * rule plus the two adjustments that matter.
 *
 * Everything here is arithmetic on a number the reader gives us. Nothing is
 * fetched, nothing is a model's opinion, and the working is shown on screen
 * — a target you can't see the reasoning for is a target you won't trust on
 * the day you don't feel like drinking it.
 *
 * It is **general guidance, not medicine.** Kidney and heart conditions, and
 * pregnancy, change the answer, and the app says so rather than pretending
 * a rule of thumb is a prescription.
 */

/** The band, in millilitres of water per kilogram of body weight, per day. */
export const ML_PER_KG_MIN = 30;
export const ML_PER_KG_MAX = 35;

/**
 * What one glass holds. The number the app counts in is *glasses*, so it
 * needs a size or the count means nothing — 400 ml is a tall glass, and it
 * is the figure every screen that mentions a glass repeats.
 */
export const GLASS_ML = 400;

/** Roughly this share of daily water arrives in food rather than a glass. */
export const FOOD_SHARE = 0.2;

export type Activity = "still" | "moderate" | "hard";

export const ACTIVITIES: {
  value: Activity;
  label: string;
  hint: string;
  /** Added to the day's target — sweat has to be replaced. */
  bonusMl: number;
}[] = [
  { value: "still", label: "Mostly still", hint: "desk work, no real sweat", bonusMl: 0 },
  {
    value: "moderate",
    label: "Moderate",
    hint: "a workout, or a sweaty commute",
    bonusMl: 425,
  },
  {
    value: "hard",
    label: "Hard, or hot",
    hint: "long training, heat, humidity, altitude",
    bonusMl: 800,
  },
];

export type WaterNeed = {
  weightKg: number;
  activity: Activity;
  /** The 30–35 ml/kg band on its own, before any activity is added. */
  bandMl: [number, number];
  /** The day's target: the top of the band plus the activity allowance. */
  ml: number;
  /** How much of that normally comes from food rather than a glass. */
  fromFoodMl: number;
  /** The target as whole glasses of GLASS_ML — what the tracker counts. */
  glasses: number;
};

/** Millilitres, to the nearest 50 — the precision the rule actually has. */
const round50 = (ml: number) => Math.round(ml / 50) * 50;

/**
 * The day's water target for a body, or null if the weight isn't a weight.
 *
 * The band is 30–35 ml/kg; the target takes the **top** of it, which is the
 * figure the common quick-reference table uses (70 kg → 2.45 L), and adds
 * the activity allowance on top. Erring high is the right way to err here:
 * the cost of a glass too many is a walk to the bathroom.
 */
export function waterNeed(weightKg: number, activity: Activity): WaterNeed | null {
  if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 400) return null;
  const bonus = ACTIVITIES.find((a) => a.value === activity)?.bonusMl ?? 0;
  // The base is rounded and the allowance added whole, not the other way
  // round: the screen says "plus 425 ml for sweat", and a total that moved
  // by 450 because of a rounding step would make that sentence a lie.
  const ml = round50(weightKg * ML_PER_KG_MAX) + bonus;
  return {
    weightKg,
    activity,
    bandMl: [round50(weightKg * ML_PER_KG_MIN), round50(weightKg * ML_PER_KG_MAX)],
    ml,
    fromFoodMl: round50(ml * FOOD_SHARE),
    // At least one: a rounding that reached zero would be an absurd goal.
    glasses: Math.max(1, Math.round(ml / GLASS_ML)),
  };
}

/** "2.8 L" / "425 ml" — litres once it is worth saying in litres. */
export function formatMl(ml: number): string {
  if (ml < 1000) return `${Math.round(ml)} ml`;
  const l = ml / 1000;
  return `${(Math.round(l * 100) / 100).toString().replace(/\.0+$/, "")} L`;
}

/** The sentence under the number: what it is and where it came from. */
export function waterLine(need: WaterNeed): string {
  const bonus = ACTIVITIES.find((a) => a.value === need.activity);
  const activity =
    bonus && bonus.bonusMl > 0
      ? `, plus ${formatMl(bonus.bonusMl)} for ${bonus.label.toLowerCase()} days`
      : "";
  return `${need.weightKg} kg × ${ML_PER_KG_MAX} ml${activity} — about ${formatMl(
    need.ml
  )} a day, which is ${need.glasses} glasses of ${GLASS_ML} ml.`;
}

/**
 * Whether a tracker is the water one, by the only evidence there is.
 *
 * There is no "water" tracker *type* — it is a count with a unit, like meals
 * or cigarettes — and inventing one to hang this off would be a schema
 * change for a naming convention. So it is a guess from the name and the
 * unit, and it is only ever used to OFFER the calculator: a wrong guess
 * shows a button nobody presses, never a wrong number.
 */
export function looksLikeWater(name: string, unit: string): boolean {
  return (
    /\bwater\b|hydrat|পানি/i.test(name) ||
    /^(glass|glasses|gilas)$/i.test(unit.trim())
  );
}
