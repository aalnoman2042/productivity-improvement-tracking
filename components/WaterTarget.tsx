"use client";

import { useState } from "react";
import { useStored } from "@/lib/useCached";
import {
  ACTIVITIES,
  GLASS_ML,
  ML_PER_KG_MAX,
  ML_PER_KG_MIN,
  formatMl,
  waterNeed,
  type Activity,
} from "@/lib/water";

/**
 * Work out the water goal instead of guessing it.
 *
 * The water tracker used to ship with "8 glasses", which is a number
 * everybody has heard and nobody has checked. The rule that scales is
 * 30–35 ml per kg of body weight, and the arithmetic is small enough to do
 * in front of the reader — so it is done in front of them: the weight, the
 * band, the activity allowance and the glass size are all on screen, and the
 * button just writes the answer into the goal field they were already
 * filling in. Nothing is saved behind their back and the number stays
 * editable afterwards, because it is a rule of thumb, not a prescription.
 *
 * The weight is remembered on this device (`useStored`) rather than added to
 * the account: it is one number used by one calculator, and a body weight
 * is not something to start syncing without being asked. Someone who tracks
 * their weight in PIT already has it on a tracker; this never goes looking
 * for it, because reading one tracker's history to prefill another's form is
 * a request nobody asked for.
 */
export default function WaterTarget({
  unit,
  onPick,
}: {
  /** The tracker's own unit, so the button speaks the reader's language. */
  unit: string;
  onPick: (glasses: number) => void;
}) {
  const [weight, setWeight] = useStored<string>("bodyWeightKg", "");
  const [activity, setActivity] = useStored<Activity>("bodyActivity", "still");
  const [open, setOpen] = useState(false);

  const need = waterNeed(parseFloat(weight), activity);
  const label = unit.trim() || "glasses";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded-md border border-dashed border-edge px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-accent hover:text-accent"
      >
        💧 Work it out from my weight
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-edge bg-surface-2 p-3">
      <p className="text-xs text-secondary">
        The usual rule is <strong>{ML_PER_KG_MIN}–{ML_PER_KG_MAX} ml of water
        per kg of body weight</strong>, a day.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor="water-weight">
          I weigh
        </label>
        <input
          id="water-weight"
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="70"
          autoFocus
          className="w-20 rounded-md border border-edge bg-transparent px-2 py-1.5 text-right text-sm outline-none focus:border-accent"
        />
        <span className="text-sm text-secondary">kg</span>

        <select
          value={activity}
          onChange={(e) => setActivity(e.target.value as Activity)}
          aria-label="How active a day"
          className="border border-edge px-2 py-1.5 text-sm"
        >
          {ACTIVITIES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      {/* The ask, when there is nothing to work from. Not an error — most
          people have simply never typed their weight into this app. */}
      {!need ? (
        <p className="mt-2 text-xs text-muted">
          Put your weight in and this works out the rest. Don&apos;t know it?
          Leave the goal at whatever feels right and come back — a goal you
          guessed is still better than no goal.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm">
            <strong className="text-lg tabular-nums">{formatMl(need.ml)}</strong>{" "}
            a day —{" "}
            <strong className="tabular-nums">
              {need.glasses} {label}
            </strong>{" "}
            at {GLASS_ML} ml a glass.
          </p>
          <p className="mt-1 text-xs text-muted">
            {formatMl(need.bandMl[0])}–{formatMl(need.bandMl[1])} for{" "}
            {need.weightKg} kg
            {activity !== "still" &&
              `, plus ${formatMl(
                ACTIVITIES.find((a) => a.value === activity)?.bonusMl ?? 0
              )} for sweat`}
            . About {formatMl(need.fromFoodMl)} of it normally arrives in food,
            so drinking a little under this is not a failure.
          </p>
          <button
            type="button"
            onClick={() => {
              onPick(need.glasses);
              setOpen(false);
            }}
            className="mt-3 rounded-lg bg-brand-gradient px-3.5 py-2 text-sm font-medium text-white hover:brightness-110"
          >
            Use {need.glasses} {label}
          </button>
        </>
      )}

      <p className="mt-3 border-t border-edge pt-2 text-xs text-muted">
        A rule of thumb, not medical advice — kidney or heart conditions and
        pregnancy change the answer.
      </p>
    </div>
  );
}
