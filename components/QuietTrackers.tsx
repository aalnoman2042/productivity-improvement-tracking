"use client";

import Link from "next/link";
import { useState } from "react";
import { useCached } from "@/lib/useCached";
import { useIdle } from "@/lib/useIdle";
import { useMounted } from "@/lib/useMounted";
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
 * tracker that was not established first.
 *
 * Dismissing is per-visit and not remembered anywhere. A stored dismissal
 * would need somewhere to live and a rule for when it expires, and the honest
 * version of "not now" on a card like this is simply that it is gone until
 * you come back — by which time the answer may have changed.
 */
export default function QuietTrackers({ onChanged }: { onChanged: () => void }) {
  // The Trackers page exists to show your trackers. This card asks a
  // secondary question, so it does not get to compete with the list for the
  // one connection a phone has — the request is not made until the page has
  // finished the work the reader was actually waiting for. Splitting it in
  // two is what makes that possible: `useCached` fetches on mount, so the
  // only way to delay the fetch is to delay the mount.
  const idle = useIdle();
  if (!idle) return null;
  return <QuietList onChanged={onChanged} />;
}

function QuietList({ onChanged }: { onChanged: () => void }) {
  const mounted = useMounted();
  const today = toDateStr(new Date());
  const q = useCached<{ quiet: Quiet[] }>(
    `/api/trackers/quiet?today=${today}`,
    "quiet"
  );

  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const quiet = (q.data?.quiet ?? []).filter((t) => !hidden.includes(t.id));

  async function archive(id: string) {
    setBusy(id);
    await fetch(`/api/trackers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    setHidden((h) => [...h, id]);
    setBusy(null);
    // The page owns the tracker list; this only knows that it changed.
    onChanged();
    void q.refresh();
  }

  // Nothing to say is the normal state of this card, and it takes up no room
  // when it has nothing to say.
  if (!mounted || quiet.length === 0) return null;

  return (
    <section className="animate-rise-in rounded-xl border border-amber-600/40 bg-amber-600/5 p-4">
      <h2 className="font-semibold">{quietLine(quiet)}</h2>
      <p className="mt-1 text-sm text-secondary">
        Pick them back up, or put them away — an archived tracker keeps
        everything it ever recorded and stops asking.
      </p>

      <ul className="mt-3 space-y-2">
        {quiet.map((t) => (
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
              className="rounded-md border border-edge px-2.5 py-1.5 text-sm text-secondary hover:bg-surface-2 disabled:opacity-40"
            >
              {busy === t.id ? "Archiving…" : "Archive"}
            </button>
            <button
              type="button"
              onClick={() => setHidden((h) => [...h, t.id])}
              className="rounded-md px-2 py-1.5 text-sm text-muted hover:text-secondary"
              aria-label={`Dismiss ${t.name}`}
            >
              Not now
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
