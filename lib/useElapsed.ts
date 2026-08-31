"use client";

import { useEffect, useState } from "react";
import { toDateStr } from "./dates";

/**
 * How much of a day has actually happened, in minutes since its midnight —
 * or `null` when the day isn't today.
 *
 * A day's log is judged against 24 hours, which is right for a day that is
 * over and unfair for one at lunchtime: ten hours logged by 1pm is a full
 * account of the day so far, and against 24 it reads as a failure. So the
 * clock is a second denominator, and this is where it comes from.
 *
 * It starts at `null` and fills in after mount, deliberately: the server has
 * no idea what time it is where you are, and rendering a time on the server
 * is how you get hydration mismatches. It re-reads every minute, so a page
 * left open overnight doesn't keep insisting it is still yesterday.
 */
export function useMinutesElapsed(date: string): number | null {
  // The reading carries the day it was taken for, and the answer is only
  // handed out when the two still agree. A bare `number | null` did not
  // survive changing the date: the state kept the old day's minutes while
  // the render already had the new date, and for the one frame between the
  // commit and the effect the daily page told someone that fourteen hours of
  // *tomorrow* were unaccounted for. The reset has to be synchronous with
  // the prop, which means derived, not stored.
  const [read, setRead] = useState<{ date: string; minutes: number } | null>(
    null
  );

  useEffect(() => {
    const take = () => {
      const now = new Date();
      const stamp = toDateStr(now);
      setRead({ date: stamp, minutes: now.getHours() * 60 + now.getMinutes() });
    };
    // Out of the effect's synchronous phase — this codebase's one lint rule
    // about effects, and the reason nothing here cascades a second render.
    const first = setTimeout(take, 0);
    const timer = setInterval(take, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [date]);

  return read && read.date === date ? read.minutes : null;
}
