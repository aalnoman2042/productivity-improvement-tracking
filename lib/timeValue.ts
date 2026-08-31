import { formatMinutes } from "./dates";

/**
 * What an hour of your life is worth, and what you spent it on.
 *
 * The idea is the oldest one in personal finance turned on its head: instead
 * of asking what a thing costs in money, ask what it costs in *life*. Four
 * hours a day on a screen is not four hours — at a wage anyone can name, it
 * is a sum with commas in it, every month, forever.
 *
 * Three rules keep this from becoming a guilt machine, which is the failure
 * mode of every app that has tried it:
 *
 * 1. **It is not money you lost.** Nobody took it. It is what the time was
 *    worth at a price *you* set, which is a way of seeing the size of a
 *    number, not an accusation. The card says so in as many words.
 * 2. **The good half is shown beside the bad half.** An app that totals only
 *    what you wasted is lying by omission: the same hours that hold the
 *    scrolling hold the studying, and a person who put 20 hours into
 *    something deserves to see that priced too.
 * 3. **Nothing is a "waste" unless you said so.** The app never decides that
 *    for anyone. It reads the habit flag already on the tracker — the one
 *    that has always meant "less of this is better" — so what counts as
 *    burned time is whatever its owner marked as a bad habit.
 *
 * Everything here is pure: the route feeds it rows, the card renders what it
 * returns, and the tests hold both to the same arithmetic.
 */

export type TimeValue = {
  /** What one minute is worth, in whole currency units. */
  perMinute: number;
  /** A symbol or short code — the reader's own money, never assumed. */
  currency: string;
};

/** Offered as chips; anything can be typed instead. */
export const CURRENCIES = ["৳", "$", "€", "£", "₹", "¥", "﷼"];

/** A price nobody could mean: an hour worth more than a small country. */
const MAX_PER_MINUTE = 10_000;

export function parseTimeValue(raw: unknown): TimeValue | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const perMinute = Number(v.perMinute);
  if (!Number.isFinite(perMinute) || perMinute <= 0 || perMinute > MAX_PER_MINUTE) {
    return null;
  }
  const currency =
    typeof v.currency === "string" && v.currency.trim()
      ? v.currency.trim().slice(0, 4)
      : "$";
  return { perMinute, currency };
}

/**
 * Money, said the way money is said: no decimals once it is big enough to
 * stop mattering, thousands separated so the size is legible at a glance —
 * which is the entire point of putting a price on an hour.
 */
export function formatMoney(amount: number, currency: string): string {
  const rounded = amount >= 100 ? Math.round(amount) : Math.round(amount * 10) / 10;
  return `${currency}${rounded.toLocaleString("en-US")}`;
}

export type SpendRow = {
  trackerId: string;
  name: string;
  color: string;
  minutes: number;
  cost: number;
};

export type SpendSide = {
  minutes: number;
  cost: number;
  /** Biggest first — the one worth doing something about is at the top. */
  rows: SpendRow[];
};

export type TimeSpend = {
  from: string;
  to: string;
  days: number;
  /**
   * Every minute on record that is measured in hours, sleep included, and
   * what all of it is worth. The literal answer to "what has my tracked time
   * been worth?" — the two columns below are that same total, split.
   */
  tracked: SpendSide;
  /** Sleep, priced but never judged — see the note on `timeSpend`. */
  slept: SpendSide;
  /** Time on trackers their owner marked as bad habits. */
  burned: SpendSide;
  /** Time on everything else that is measured in hours. */
  invested: SpendSide;
  /** Burned minutes per day across the window, logged days or not. */
  perDay: number;
  /** What a year at this rate would come to — the number that lands. */
  perYear: { minutes: number; cost: number };
  /**
   * Burned time as a share of *waking* hours, 0–1.
   *
   * Null unless sleep was actually tracked in the window: the alternative is
   * to assume eight hours a night, and an invented denominator makes an
   * invented percentage. The app knows how much this person slept or it says
   * nothing.
   */
  wakingShare: number | null;
};

export type SpendTracker = {
  id: string;
  name: string;
  color: string;
  type: string;
  habit?: "good" | "bad";
};

export type SpendEntry = { trackerId: string; value: number };

/** Only time can be priced by the hour. A count of coffees is not hours. */
const TIME_TYPES = new Set(["duration", "sleep"]);

/**
 * What the window cost — all of it, and then split.
 *
 * `tracked` is every hour-measured minute on record, which is the question
 * as it was actually asked: what has my tracked time been worth. Sleep is
 * inside that total and gets a line of its own, but it is in **neither** the
 * burned nor the invested column, because it is not an activity you chose
 * over another one — it is the floor the day stands on, and an app that
 * prices somebody's sleep as a loss has stopped being honest and started
 * being cruel. It also sets the denominator for `wakingShare`.
 */
export function timeSpend(input: {
  trackers: SpendTracker[];
  entries: SpendEntry[];
  from: string;
  to: string;
  days: number;
  value: TimeValue;
}): TimeSpend {
  const { trackers, entries, from, to, days, value } = input;
  const byId = new Map(trackers.map((t) => [t.id, t]));

  const burned = new Map<string, number>();
  const invested = new Map<string, number>();
  const slept = new Map<string, number>();
  const tracked = new Map<string, number>();
  let sleepMinutes = 0;

  for (const e of entries) {
    const t = byId.get(e.trackerId);
    if (!t || !TIME_TYPES.has(t.type)) continue;
    const minutes = Math.max(0, Number(e.value) || 0);
    tracked.set(e.trackerId, (tracked.get(e.trackerId) ?? 0) + minutes);
    if (t.type === "sleep") {
      sleepMinutes += minutes;
      slept.set(e.trackerId, (slept.get(e.trackerId) ?? 0) + minutes);
      continue;
    }
    const bucket = t.habit === "bad" ? burned : invested;
    bucket.set(e.trackerId, (bucket.get(e.trackerId) ?? 0) + minutes);
  }

  const side = (totals: Map<string, number>): SpendSide => {
    const rows: SpendRow[] = [...totals.entries()]
      .map(([trackerId, minutes]) => {
        const t = byId.get(trackerId)!;
        return {
          trackerId,
          name: t.name,
          color: t.color,
          minutes,
          cost: minutes * value.perMinute,
        };
      })
      .filter((r) => r.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes);
    const minutes = rows.reduce((sum, r) => sum + r.minutes, 0);
    return { minutes, cost: minutes * value.perMinute, rows };
  };

  const burnedSide = side(burned);
  const investedSide = side(invested);

  const span = Math.max(1, days);
  const perDay = burnedSide.minutes / span;
  const perYearMinutes = perDay * 365;

  // Waking hours only, and only when sleep is on record. A day is 1,440
  // minutes; what is left after sleeping is what there was to spend.
  const wakingMinutes = span * 1440 - sleepMinutes;
  const wakingShare =
    sleepMinutes > 0 && wakingMinutes > 0
      ? Math.min(1, burnedSide.minutes / wakingMinutes)
      : null;

  return {
    from,
    to,
    days: span,
    tracked: side(tracked),
    slept: side(slept),
    burned: burnedSide,
    invested: investedSide,
    perDay,
    perYear: { minutes: perYearMinutes, cost: perYearMinutes * value.perMinute },
    wakingShare,
  };
}

/**
 * The sentence the card leads with.
 *
 * Written here rather than in the component because it is the one part of
 * this feature that could be cruel, and a line that judgemental belongs
 * where it can be read, argued with and tested. It states, it does not
 * scold, and when there is nothing to report it says that instead of
 * inventing a worry.
 */
/**
 * How many days a window needs before extrapolating from it is honest.
 *
 * Periods are calendar units now, so on the 1st of a month the window is
 * ONE day — and one partly-lived day. Forty-five minutes of scrolling before
 * lunch became "at that rate a year costs ৳82,000", which is arithmetic
 * rather than information: the rate is a rounding error times 365. Under the
 * old rolling windows the denominator was a fixed 7, 15 or 30 and a single
 * day could never dominate it like this.
 */
const RATE_NEEDS_DAYS = 5;

export function spendLine(spend: TimeSpend, currency: string): string {
  if (spend.burned.minutes === 0) {
    return spend.invested.minutes > 0
      ? `Nothing on record as time badly spent. ${formatMinutes(
          spend.invested.minutes
        )} went into what you're building.`
      : "No hours priced yet — mark a tracker as a bad habit and this fills in.";
  }
  const money = formatMoney(spend.burned.cost, currency);
  const spent = `${formatMinutes(spend.burned.minutes)} went to habits you'd rather drop — ${money} of your own time.`;
  if (spend.days < RATE_NEEDS_DAYS) return spent;
  const perYear = formatMoney(spend.perYear.cost, currency);
  return `${spent} At that rate a year costs ${perYear}.`;
}
