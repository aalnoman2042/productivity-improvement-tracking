"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNearViewport } from "@/lib/useNearViewport";
import { toDateStr } from "@/lib/dates";
import { CATCHUP_DAYS, missedDays, type CatchupDay } from "@/lib/catchup";

/**
 * "Four days are blank" — and one tap to the screen that closes them.
 *
 * The app has always known this and never said it: a gap shows up as a
 * smaller number on a tile, which reads as *you did less*, not as *the
 * record is incomplete*. Those are different problems and only one of them
 * can be fixed after the fact.
 *
 * Renders **nothing at all** when the record is whole, which is most days —
 * a card that says "well done, nothing missing" every time you open Status
 * is a card people learn to scroll past. It also stays silent about a single
 * blank day: one missed day is a life, not a lapse.
 */

const NOTICE_AT = 2;

export default function CatchupCard() {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const [days, setDays] = useState<CatchupDay[] | null>(null);
  const today = toDateStr(new Date());

  useEffect(() => {
    if (!near) return;
    let live = true;
    fetch(`/api/catchup?today=${today}&back=${CATCHUP_DAYS}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { days: CatchupDay[] }) => live && setDays(body.days))
      // Silent on purpose: this card is an offer, and an offer that failed
      // to load is not news anybody needs on the status page.
      .catch(() => live && setDays([]));
    return () => {
      live = false;
    };
  }, [near, today]);

  // Computed before the early returns — see npm run check:shape.
  const missed = days ? missedDays(days) : [];
  const enough = missed.length >= NOTICE_AT;

  return (
    <div ref={ref}>
      {enough && (
        <Link
          href="/catchup"
          className="animate-rise-in flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-600/40 bg-amber-500/15 p-3 text-sm shadow-sm"
        >
          <span className="font-medium">
            🗓 {missed.length} blank days in the last {CATCHUP_DAYS}
          </span>
          <span className="min-w-0 text-secondary">
            Fill them in with taps, or mark off the ones you were away.
          </span>
          <span className="ml-auto font-medium text-accent">Catch up →</span>
        </Link>
      )}
    </div>
  );
}
