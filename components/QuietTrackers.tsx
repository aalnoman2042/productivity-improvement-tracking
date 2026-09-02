"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useIdle } from "@/lib/useIdle";
import { prettyDate, toDateStr } from "@/lib/dates";
import { seriesColor } from "@/lib/palette";
import { quietLine, type Quiet } from "@/lib/fading";

/**
 * "These have been quiet for a while."
 *
 * The only place in the app that notices a habit has stopped. It offers two
 * answers and treats them as equals — open it again, or put it away — because
 * they genuinely are: a habit you have finished with deserves archiving, and
 * archiving it is what stops the Trackers page turning into a list of things
 * you are failing at. See `lib/fading.ts` for why it never speaks about a
 * tracker that was not established first, and why a planned day off is not
 * silence.
 *
 * Dismissing is per-visit and not remembered anywhere. A stored dismissal
 * would need somewhere to live and a rule for when it expires, and the honest
 * version of "not now" on a card like this is simply that it is gone until
 * you come back — by which time the answer may have changed.
 */
export default function QuietTrackers({
  onChanged,
  hidden = false,
}: {
  onChanged: () => void;
  /** Rendered away while the add/pack forms are open — but NOT unmounted. */
  hidden?: boolean;
}) {
  // The Trackers page exists to show your trackers. This card asks a
  // secondary question, so it does not get to compete with the list for the
  // one connection a phone has — nothing is requested until the page has
  // finished the work the reader was actually waiting for. Splitting the
  // component in two is what makes that possible: the fetch runs on mount,
  // so the only way to delay the fetch is to delay the mount.
  const idle = useIdle();
  if (!idle) return null;
  return <QuietList onChanged={onChanged} hidden={hidden} />;
}

function QuietList({
  onChanged,
  hidden,
}: {
  onChanged: () => void;
  hidden: boolean;
}) {
  // Read once, deliberately NOT through `useCached` — and the cache layer
  // itself is untouched by that choice.
  //
  // Two reasons. This is the most expensive read in the app: a group-by over
  // every entry the account has ever written, and `useCached` re-runs its key
  // every 60 seconds for as long as the screen is open. And the answer has
  // ten-day granularity (`QUIET_DAYS`) — polling it every minute asks a
  // question fourteen thousand times between two possible answers.
  const [quiet, setQuiet] = useState<Quiet[] | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let cancelled = false;
    // Out of the effect's synchronous phase: a state update inside one is the
    // lint rule this codebase enforces.
    void Promise.resolve().then(async () => {
      try {
        const res = await fetch(
          `/api/trackers/quiet?today=${toDateStr(new Date())}`
        );
        if (!res.ok) return;
        const body = (await res.json()) as { quiet?: Quiet[] };
        if (!cancelled) setQuiet(body.quiet ?? []);
      } catch {
        // Offline. This card is the least important thing on the page, so it
        // says nothing rather than reporting a failure nobody asked about.
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = (quiet ?? []).filter((t) => !dismissed.includes(t.id));

  async function archive(id: string) {
    setBusy(id);
    setFailed("");
    try {
      const res = await fetch(`/api/trackers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDismissed((h) => [...h, id]);
      // The page owns the tracker list; this only knows that it changed.
      onChanged();
    } catch {
      // Archiving is not a day's log, so it deliberately does NOT go through
      // the offline queue: a queued archive would tell somebody a tracker was
      // put away and then show it again on the next load. Saying it did not
      // happen is the honest answer.
      setFailed("Couldn't archive that — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  // Nothing to say is the normal state of this card, and it takes up no room
  // when it has nothing to say. `hidden` renders it away WITHOUT unmounting,
  // so opening and closing the add-tracker form cannot re-run that read.
  if (hidden || shown.length === 0) return null;

  return (
    <section className="animate-rise-in rounded-xl border border-amber-600/40 bg-amber-600/5 p-4">
      <h2 className="font-semibold">{quietLine(shown)}</h2>
      <p className="mt-1 text-sm text-secondary">
        Pick them back up, or put them away — an archived tracker keeps
        everything it ever recorded and stops asking.
      </p>

      {failed && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {failed}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {shown.map((t) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-edge card p-2.5 shadow-sm"
          >
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: seriesColor(t.color) }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{t.name}</span>
              <span className="block text-xs text-secondary">
                {t.days} days kept · last on {prettyDate(t.last)}
              </span>
            </span>
            <Link
              href="/"
              className="rounded-md border border-edge px-2.5 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
            >
              Log it
            </Link>
            <button
              type="button"
              onClick={() => void archive(t.id)}
              disabled={busy === t.id}
              aria-label={`Archive ${t.name}`}
              className="rounded-md border border-edge px-2.5 py-1.5 text-sm text-secondary hover:bg-surface-2 disabled:opacity-40"
            >
              {busy === t.id ? "Archiving…" : "Archive"}
            </button>
            <button
              type="button"
              onClick={() => setDismissed((h) => [...h, t.id])}
              className="rounded-md px-2 py-1.5 text-sm text-muted hover:text-secondary"
              aria-label={`Dismiss ${t.name} for now`}
            >
              Not now
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
