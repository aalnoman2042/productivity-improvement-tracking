"use client";

import { useEffect, useState } from "react";
import {
  formatBytes,
  headroom,
  usedBytes,
  type StorageReport as Report,
} from "@/lib/storage";

/**
 * What the database is holding, and how close that is to the ceiling.
 *
 * The counts elsewhere on this page answer "is anyone using it?". This
 * answers the other admin question, the one with a deadline attached: a free
 * Atlas cluster that fills up does not slow down, it stops accepting writes.
 * Better to watch a bar that has been at 1% for a year than to find out from
 * a failed save.
 *
 * Indexes are counted with the data on purpose. On a database this size they
 * are usually *most* of the total — which looks wrong and is completely
 * normal — and leaving them out would under-report the thing that fills up.
 */

const TONE = {
  fine: { bar: "bg-green-600", text: "text-green-700 dark:text-green-500" },
  watch: { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-500" },
  full: { bar: "bg-red-600", text: "text-red-600" },
} as const;

export default function StorageReport() {
  const [data, setData] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/storage")
      .then(async (res) => {
        if (!res.ok) throw new Error(`storage ${res.status}`);
        const body = await res.json();
        // Checked before it is trusted, because this card is rendered inside
        // someone else's page: a response that isn't the shape this expects
        // must cost one card, never the whole screen. `dbStats` is a command
        // a cluster is allowed to refuse, and what comes back then is not
        // this component's to guess at.
        if (
          !body ||
          typeof body !== "object" ||
          !body.totals ||
          !Array.isArray(body.collections)
        ) {
          throw new Error("storage: unexpected shape");
        }
        return body as Report;
      })
      .then((report) => {
        if (live) setData(report);
      })
      .catch((err) => {
        console.error("Admin storage card:", err);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // Computed before any early return, and that is not a style preference.
  // With `const used = …` declared *after* the two early returns below and
  // read from the JSX, the React Compiler emitted a build where the binding
  // was out of scope by the time it was read: production threw
  // "ReferenceError: used is not defined" while dev, lint, tsc and the build
  // were all perfectly clean. A component body the compiler memoises should
  // compute what it needs before it starts returning early.
  const used = data ? usedBytes(data.totals) : 0;
  const room = headroom(used, data?.limitBytes ?? 0);
  const tone = TONE[room.level];

  if (failed) {
    return (
      <section className="rounded-xl border border-edge card p-4 shadow-sm">
        <h2 className="font-semibold">💾 Database</h2>
        <p className="mt-1 text-sm text-secondary">
          Couldn&apos;t read the cluster&apos;s size — some clusters refuse
          the command that reports it. Everything else on this page is
          unaffected, and the reason is in the browser console.
        </p>
      </section>
    );
  }

  if (!data) {
    return (
      <div className="skeleton h-40 rounded-xl" aria-hidden="true">
        <span className="sr-only">Reading database size…</span>
      </div>
    );
  }

  return (
    <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold">💾 Database</h2>
        <span className={`text-xs font-medium ${tone.text}`}>
          {room.percent < 1 ? "under 1%" : `${room.percent}%`} of{" "}
          {formatBytes(data.limitBytes)}
        </span>
      </div>

      <p className="mt-2 text-2xl font-bold tabular-nums">{formatBytes(used)}</p>
      <p className="text-xs text-muted">
        {formatBytes(data.totals.storageSize)} of documents on disk ·{" "}
        {formatBytes(data.totals.indexSize)} of indexes ·{" "}
        <span className="tabular-nums">{data.totals.objects.toLocaleString()}</span>{" "}
        rows in total
      </p>

      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`${room.percent}% of the database allowance used`}
      >
        <div
          className={`h-full rounded-full ${tone.bar}`}
          // A bar that rounds to nothing still deserves to be visible.
          style={{ width: `${Math.max(room.percent, 1)}%` }}
        />
      </div>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-edge text-left text-xs text-secondary">
            <th className="py-2 font-medium">Collection</th>
            <th className="py-2 text-right font-medium">Rows</th>
            <th className="py-2 text-right font-medium">Data</th>
            <th className="py-2 text-right font-medium">Indexes</th>
          </tr>
        </thead>
        <tbody>
          {data.collections.map((c) => (
            <tr key={c.name} className="border-b border-edge last:border-b-0">
              <td className="py-2 font-medium">{c.name}</td>
              <td className="py-2 text-right tabular-nums text-secondary">
                {c.count.toLocaleString()}
              </td>
              <td className="py-2 text-right tabular-nums text-secondary">
                {formatBytes(c.storageSize)}
              </td>
              <td className="py-2 text-right tabular-nums text-muted">
                {formatBytes(c.indexSize)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-xs text-muted">
        Sizes only — no row is read to produce this. Indexes are counted
        towards the total because the cluster counts them; on a database this
        small they are usually the larger half.
      </p>
    </section>
  );
}
