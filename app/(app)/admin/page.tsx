"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminHealth from "@/components/AdminHealth";
import CardBoundary from "@/components/CardBoundary";
import NudgeButton from "@/components/NudgeButton";
import PremiumToggle from "@/components/PremiumToggle";
import StorageReport from "@/components/StorageReport";
import { DEFAULT_NUDGE, MAX_NUDGE, cleanNudge } from "@/lib/nudge";

type Row = {
  id: string;
  name: string;
  joined: string | null;
  trackers: number;
  loggedDays: number;
  devices: number;
  remindersOn: boolean;
  /** Whether the AI coach and the health page are on for this account. */
  invited: boolean;
};

type Overview = {
  totalUsers: number;
  skip: number;
  limit: number;
  hasMore: boolean;
  users: Row[];
};

export default function AdminPage() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [message, setMessage] = useState(DEFAULT_NUDGE);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setData)
      // Not signed in or not an admin — either way this page isn't theirs.
      .catch(() => router.replace("/settings"));
  }, [router]);

  /**
   * The accounts arrive a page at a time — the route counts trackers, days
   * and devices only for the rows it is about to return, which is what keeps
   * this page the same cost at two thousand users as at ten.
   */
  async function loadMore() {
    if (!data) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/admin/users?skip=${data.users.length}&limit=${data.limit}`
      );
      if (!res.ok) return;
      const next = (await res.json()) as Overview;
      setData({ ...next, skip: 0, users: [...data.users, ...next.users] });
    } finally {
      setLoadingMore(false);
    }
  }

  /** One row's premium flag, changed in place so the table stays put. */
  function setInvited(id: string, invited: boolean) {
    setData((current) =>
      current === null
        ? current
        : {
            ...current,
            users: current.users.map((u) => (u.id === id ? { ...u, invited } : u)),
          }
    );
  }

  // Everything computed before the first early return — see check:shape.
  const toSend = cleanNudge(message) ?? DEFAULT_NUDGE;
  const reachable = data?.users.filter((u) => u.devices > 0).length ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-secondary">
          Every account, counted, and what the database is holding. Names,
          numbers and sizes only — nobody&apos;s actual data is readable from
          here. <strong className="font-medium">Premium</strong> switches the
          two features with a bill attached — the AI coach and the health
          page — for one account; everything else is open to everybody.
        </p>
      </div>

      {data === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <div className="card-stack">
            <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
              <p className="text-sm text-secondary">Users</p>
              <p className="text-3xl font-bold tabular-nums">{data.totalUsers}</p>
            </section>

            {/* Fenced: its own request, and now its own failure. Whatever
                goes wrong in there — a refused command, a shape nobody
                expected, a bug — costs this page one card and never the
                accounts below it. */}
            {/* Is it working, before is it used. Fenced separately from the
                storage card so one cannot take the other. */}
            <CardBoundary
              title="🩺 Health"
              message="Couldn't read the app's health. Everything else on this page is unaffected."
            >
              <AdminHealth />
            </CardBoundary>

            <CardBoundary
              title="💾 Database"
              message="Couldn't read the database's size. Everything else on this page is unaffected."
            >
              <StorageReport />
            </CardBoundary>

            {/* The message every 🔔 in the table below sends. One box rather
                than one per row: it is nearly always the same sentence going
                to whoever has gone quiet. */}
            <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
              <h2 className="font-semibold">🔔 Nudge</h2>
              <p className="mt-1 text-sm text-secondary">
                Put this on someone&apos;s phone now. It goes to any browser that
                allowed notifications — <strong>their nightly reminder can be
                off</strong>; that switch only decides whether the app asks on its
                own.
              </p>
              <label htmlFor="nudge-message" className="sr-only">
                Notification message
              </label>
              <textarea
                id="nudge-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                maxLength={MAX_NUDGE}
                placeholder={DEFAULT_NUDGE}
                className="mt-3 w-full resize-none rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
              />
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted">
                {/* A notification is a headline and a line under it, and the
                    first dash or full stop is where this one breaks. Showing
                    the split beats explaining it. */}
                {/* Counted over the rows actually loaded, not the whole
                    database — the table pages in. */}
                <span>
                  Sends as “{toSend}” · {reachable} of {data.users.length} shown
                  can receive it
                </span>
                <button
                  type="button"
                  onClick={() => setMessage(DEFAULT_NUDGE)}
                  className="rounded-md px-2 py-1 text-xs text-secondary hover:bg-surface-2"
                >
                  Reset
                </button>
              </div>
            </section>
          </div>

          {/* Full width, outside the columns: a table squeezed into half a
              screen is a table that scrolls sideways. */}
          <section className="animate-rise-in overflow-x-auto rounded-xl border border-edge card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-secondary">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 text-right font-medium">Trackers</th>
                  <th className="px-4 py-3 text-right font-medium">Logged days</th>
                  <th className="px-4 py-3 text-right font-medium">Premium</th>
                  <th className="px-4 py-3 text-right font-medium">Notify</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} className="border-b border-edge last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="block font-medium">{u.name}</span>
                      {u.joined && (
                        <span className="block text-xs text-muted">since {u.joined}</span>
                      )}
                      {/* Worth saying out loud beside the button: these two
                          come apart, and the nudge ignores the switch. */}
                      <span className="block text-xs text-muted">
                        {u.devices > 0
                          ? `${u.devices} device${u.devices === 1 ? "" : "s"} · nightly ask ${u.remindersOn ? "on" : "off"}`
                          : "notifications not allowed"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{u.trackers}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{u.loggedDays}</td>
                    <td className="px-4 py-3 text-right">
                      <PremiumToggle
                        userId={u.id}
                        name={u.name}
                        invited={u.invited}
                        onChange={(invited) => setInvited(u.id, invited)}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <NudgeButton
                        userId={u.id}
                        name={u.name}
                        message={toSend}
                        devices={u.devices}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.hasMore && (
              <div className="border-t border-edge p-3 text-center">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-secondary hover:bg-surface-2 disabled:opacity-40"
                >
                  {loadingMore
                    ? "Loading…"
                    : `Show more (${data.users.length} of ${data.totalUsers})`}
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
