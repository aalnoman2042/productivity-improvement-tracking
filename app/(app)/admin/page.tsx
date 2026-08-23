"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import StorageReport from "@/components/StorageReport";

type Row = {
  id: string;
  name: string;
  joined: string | null;
  trackers: number;
  loggedDays: number;
};

type Overview = { totalUsers: number; users: Row[] };

export default function AdminPage() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setData)
      // Not signed in or not an admin — either way this page isn't theirs.
      .catch(() => router.replace("/settings"));
  }, [router]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-secondary">
          Every account, counted, and what the database is holding. Names,
          numbers and sizes only — nobody&apos;s actual data is readable from
          here.
        </p>
      </div>

      {data === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
            <p className="text-sm text-secondary">Users</p>
            <p className="text-3xl font-bold tabular-nums">{data.totalUsers}</p>
          </section>

          {/* Its own request, so a cluster that won't report its size costs
              this page nothing but one card. */}
          <StorageReport />

          <section className="animate-rise-in overflow-x-auto rounded-xl border border-edge card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-secondary">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 text-right font-medium">Trackers</th>
                  <th className="px-4 py-3 text-right font-medium">Logged days</th>
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
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{u.trackers}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{u.loggedDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
