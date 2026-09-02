"use client";

import { useState } from "react";
import { EMPTY, draftToEntry, type Draft } from "@/lib/draft";
import { oddValue, type Baseline } from "@/lib/outlier";
import type { Tracker, TrackerType } from "@/lib/trackers";

/**
 * The one question this app asks about a number you typed.
 *
 * It sits under the row, in amber, and it is a question rather than a
 * refusal — the save is already on its way while this is on screen (rule
 * 2b: nothing stands between a person and their own record). Confirming
 * changes nothing at all; it only stops the asking, because a warning that
 * cannot be answered is a warning you learn to read past.
 *
 * See `lib/outlier.ts` for why the bar is four times your usual day and not
 * three, and why sleep and the bounded kinds are not watched here.
 */
export default function OddValue({
  tracker,
  draft,
  baseline,
}: {
  tracker: Tracker;
  draft: Draft | undefined;
  /** What this tracker's ordinary day looks like; absent = too little history. */
  baseline: Baseline | undefined;
}) {
  // Which exact number has been confirmed, not merely *that* one was.
  // Correcting 14h to 1h 40m and then fat-fingering 9h has to ask again,
  // and a boolean would have stayed dismissed through both.
  const [accepted, setAccepted] = useState<number | null>(null);

  const { value } = draftToEntry(tracker.type as TrackerType, draft ?? EMPTY);
  const odd = oddValue(tracker, value, baseline);

  if (!odd || accepted === value) return null;

  return (
    <p
      // Announced, because this appears on its own while somebody is typing
      // and nothing else on screen changes. "polite" so it waits for a pause
      // rather than interrupting the digit being entered.
      role="status"
      aria-live="polite"
      className="animate-fade-in flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-600/40 bg-amber-600/5 p-2 text-xs text-secondary"
    >
      <span>
        <span className="text-amber-700 dark:text-amber-500">
          {odd.direction === "high"
            ? `${odd.times}× your usual`
            : `a ${odd.times}th of your usual`}
        </span>{" "}
        ({odd.usual}). Right?
      </span>
      <button
        type="button"
        onClick={() => setAccepted(value)}
        // The visible word is "Yes" because the sentence above it asks
        // "Right?" — but on its own it answers nothing, so the accessible
        // name says which number is being confirmed and for what.
        aria-label={`Yes, ${tracker.name} is correct`}
        className="ml-auto rounded-md border border-edge px-2 py-1 font-medium hover:border-accent hover:text-accent"
      >
        Yes
      </button>
    </p>
  );
}
