"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import TapGrid from "@/components/TapGrid";
import LoadError from "@/components/LoadError";
import { useCached } from "@/lib/useCached";
import { post } from "@/lib/sync";
import { prettyDate, toDateStr } from "@/lib/dates";
import { EMPTY, draftNote, draftToEntry, type Draft } from "@/lib/draft";
import { CATCHUP_DAYS, catchupLine, missedDays, type CatchupDay } from "@/lib/catchup";
import type { Tracker, TrackerType } from "@/lib/trackers";

/**
 * Catching up on the days that got away.
 *
 * The app has always been able to log any date — you just had to go and find
 * each one, a screen at a time, and nobody does that for the fourth day in a
 * row. So this is the same writes with the navigation taken out: the blank
 * days in a list, oldest first, each answerable in taps.
 *
 * **Only the tap kinds are offered.** Reconstructing "did I pray / did I
 * stay clean / was that a good day" from memory is honest; typing that you
 * slept 7h 20m a week last Tuesday is not — that is invention, and this app
 * would rather have a gap than a made-up number. Anything more than a tap is
 * a link to the full day.
 *
 * And the other true answer is one tap too: **a day off** (`lib/rest`).
 * Marking one costs nothing, changes no number, and stops a deliberate week
 * away reading as the week somebody quit.
 */

type Payload = {
  today: string;
  back: number;
  days: CatchupDay[];
  trackers: number;
};

const TAP_TYPES: TrackerType[] = ["check", "streak", "scale", "prayer"];

export default function CatchupPage() {
  const today = toDateStr(new Date());
  const trackersQ = useCached<Tracker[]>("/api/trackers", "trackers");

  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Record<string, Draft>>>({});
  const [state, setState] = useState<Record<string, "saving" | "saved" | "off">>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** The drafts as they stand right now — what the save timer reads. */
  const latest = useRef<Record<string, Record<string, Draft>>>({});

  const load = () => {
    setFailed("");
    fetch(`/api/catchup?today=${today}&back=${CATCHUP_DAYS}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("catchup"))))
      .then((body: Payload) => setData(body))
      .catch(() => setFailed("Couldn't read which days are missing."));
  };

  useEffect(() => {
    // Deferred a microtask so the state change lands after the round trip
    // rather than inside the effect — the lint rule this codebase enforces.
    void Promise.resolve().then(load);
    // `load` is stable enough for this: it closes over `today`, which cannot
    // change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  // Everything computed before the early returns — see npm run check:shape.
  const trackers = (trackersQ.data ?? []).filter((t) => !t.archived);
  const taps = trackers.filter((t) => TAP_TYPES.includes(t.type as TrackerType));
  const days = data?.days ?? [];
  const missed = missedDays(days);
  const line = data ? catchupLine(days, data.back) : "";
  // A day answered in this sitting stays on screen — it would be unnerving
  // for the card under your thumb to vanish — but it stops being missing.
  const answered = Object.keys(state).length;
  const left = Math.max(0, missed.length - answered);

  /**
   * One tracker on one day, saved on its own.
   *
   * The pending value is kept in a ref as well as in state, because the save
   * happens on a timer and a state updater is not the place to run one: React
   * is allowed to call an updater more than once, and a `post` inside one
   * would send the day twice.
   */
  function set(date: string, id: string, patch: Partial<Draft>) {
    const day = { ...(latest.current[date] ?? {}) };
    day[id] = { ...(day[id] ?? EMPTY), ...patch };
    latest.current = { ...latest.current, [date]: day };
    setDrafts(latest.current);

    setState((prev) => ({ ...prev, [date]: "saving" }));

    const key = `${date}:${id}`;
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      const tracker = taps.find((x) => x.id === id);
      if (!tracker) return;
      const dr = latest.current[date]?.[id] ?? EMPTY;
      void post("/api/entries", {
        date,
        entries: [
          {
            trackerId: id,
            ...draftToEntry(tracker.type as TrackerType, dr),
            note: draftNote(dr),
          },
        ],
      })
        // "queued" counts as saved: the offline queue is how every other
        // write on a phone in a tunnel behaves, and this page is no different.
        .then(() => setState((s) => ({ ...s, [date]: "saved" })))
        .catch(() => setState((s) => ({ ...s, [date]: "saving" })));
    }, 600);
  }

  async function markOff(date: string) {
    setState((prev) => ({ ...prev, [date]: "saving" }));
    await post("/api/rest", { date, rest: true });
    setState((prev) => ({ ...prev, [date]: "off" }));
  }

  async function unmarkOff(date: string) {
    await post("/api/rest", { date, rest: false });
    setState((prev) => {
      const next = { ...prev };
      delete next[date];
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Catch up</h1>
        <p className="mt-1 text-sm text-secondary">
          The blank days, oldest first. Taps only — anything you&apos;d have to
          remember a number for belongs on{" "}
          <Link href="/" className="font-medium text-accent underline">
            the full day
          </Link>
          , and a day you were away is best marked off rather than guessed at.
        </p>
      </div>

      {failed ? (
        <LoadError what="your missing days" message={failed} onRetry={load} />
      ) : !data ? (
        <div className="space-y-3" aria-hidden="true">
          <div className="skeleton h-24 rounded-xl" />
          <div className="skeleton h-24 rounded-xl" />
        </div>
      ) : data.trackers === 0 ? (
        <p className="rounded-xl border border-edge card p-4 text-sm text-muted shadow-sm">
          There&apos;s nothing to log yet.{" "}
          <Link href="/trackers" className="font-medium text-accent underline">
            Add a tracker
          </Link>{" "}
          and the days start counting from there.
        </p>
      ) : (
        <>
          <p
            className={`rounded-xl border p-3 text-sm ${
              missed.length === 0
                ? "border-green-700/40 bg-green-700/10"
                : "border-accent/30 bg-accent/5"
            }`}
          >
            {line}
            {answered > 0 && missed.length > 0 && (
              <span className="block text-secondary">
                {left === 0
                  ? "That's all of them. Nothing left in the window."
                  : `${left} still blank.`}
              </span>
            )}
          </p>

          {missed.map((day) => {
            const mark = state[day.date];
            return (
              <section
                key={day.date}
                className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h2 className="font-semibold">{prettyDate(day.date)}</h2>
                  <span className="text-xs text-muted" role="status">
                    {mark === "off"
                      ? "🌙 marked off"
                      : mark === "saved"
                        ? "✓ saved"
                        : mark === "saving"
                          ? "saving…"
                          : "nothing on record"}
                  </span>
                </div>

                {mark === "off" ? (
                  <p className="mt-2 text-sm text-secondary">
                    A day off, on purpose. It counts for nothing and breaks
                    nothing.{" "}
                    <button
                      type="button"
                      onClick={() => void unmarkOff(day.date)}
                      className="font-medium text-accent hover:underline"
                    >
                      Undo
                    </button>
                  </p>
                ) : (
                  <>
                    {taps.length > 0 ? (
                      <div className="mt-3">
                        <TapGrid
                          trackers={taps}
                          draft={drafts[day.date] ?? {}}
                          set={(id, patch) => set(day.date, id, patch)}
                          date={day.date}
                        />
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted">
                        None of your trackers are one-tap kinds — open the day
                        itself to fill it in.
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void markOff(day.date)}
                        className="rounded-md border border-edge px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-2"
                      >
                        🌙 I was off that day
                      </button>
                      <Link
                        href={`/?date=${day.date}`}
                        className="rounded-md px-2 py-1.5 text-xs text-muted hover:bg-surface-2"
                      >
                        Open the full day →
                      </Link>
                    </div>
                  </>
                )}
              </section>
            );
          })}

          {missed.length === 0 && (
            <p className="rounded-xl border border-edge card p-4 text-sm text-secondary shadow-sm">
              Nothing to catch up on.{" "}
              <Link href="/" className="font-medium text-accent underline">
                Today&apos;s log
              </Link>{" "}
              is the only one open.
            </p>
          )}
        </>
      )}
    </div>
  );
}
