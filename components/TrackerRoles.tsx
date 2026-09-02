"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Select from "@/components/Select";
import type { Assignment, MissingRole, Role, RoleSource } from "@/lib/trackerRoles";

/**
 * What the app decided each of your trackers means, and how to argue with it.
 *
 * This panel exists because the detection is a **guess with consequences**.
 * If a tracker called "Reading" is read as sitting rather than as something
 * else, hours move between two numbers on the page above. So it is shown
 * rather than hidden: every tracker, the role it was given, and which of the
 * three things decided — a keyword rule, the AI, or you.
 *
 * The AI re-reads the names **by itself** — when the tracker list changes, and
 * otherwise once a week. It is not a permission prompt, because the answer to
 * "what does the tracker called Tuition mean" does not change often enough to
 * be worth asking about, and a page showing worse numbers until somebody
 * presses something is a page showing worse numbers. The button here only
 * forces it early, for the minute after a rename.
 *
 * When a read happens on load, the numbers above were computed a moment
 * earlier from the previous map — so `refreshed` tells the page to fetch them
 * again. It is the one case where this panel drives the rest of the screen.
 *
 * An override wins forever. "Not used" is a real answer — it is how you tell
 * the page that the tracker called "Work" is not desk work.
 */

type Tracker = { id: string; name: string; type: string; unit: string };
type RoleOption = { id: Role; label: string; feeds: string; types: string[]; many: boolean };

export type RolesPayload = {
  assignments: Assignment[];
  aiAt: string | null;
  stale: boolean;
  never: boolean;
  coverage: number;
  missing: MissingRole[];
  roles: RoleOption[];
  trackers: Tracker[];
  aiConfigured: boolean;
  detected?: number;
  /** Whole days since the AI last read the names, null if it never has. */
  ageDays: number | null;
  /** True when this very request re-read them — the page's cue to reload. */
  refreshed?: boolean;
};

const SOURCE_LABEL: Record<RoleSource, string> = {
  rule: "matched by name",
  ai: "read by AI",
  manual: "you set this",
};

const SOURCE_STYLE: Record<RoleSource, string> = {
  rule: "border-edge text-muted",
  ai: "border-accent/40 bg-accent/10 text-accent",
  manual: "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-500",
};

export default function TrackerRoles({
  onChanged,
}: {
  /** The page above re-reads its numbers when a role moves — they depend on it. */
  onChanged: () => void;
}) {
  // Held in a ref rather than closed over: `onChanged` is the page's reload,
  // whose identity changes when the reader switches the 7/14/30-day window.
  // In `load`'s dependency list that would re-fetch this panel every time the
  // window moved — a wasted round trip, and one that runs the due check again.
  const changed = useRef(onChanged);

  const [data, setData] = useState<RolesPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/health/roles");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as RolesPayload;
      setData(body);
      // This GET may have re-read the names and changed what feeds the
      // numbers above, which were computed from the previous map moments ago.
      if (body.refreshed) {
        setNote(
          `Re-read your trackers — ${body.detected ?? 0} recognised. The numbers above have been recalculated.`
        );
        changed.current();
      }
    } catch {
      setError("Couldn't read what your trackers mean");
    }
  }, []);

  // Kept current in an effect, never assigned during render — this repo's
  // React Compiler lint rejects a ref write in the render body, and it is
  // right to: a ref updated during render can be read stale by the same pass.
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  async function detect() {
    setBusy("ai");
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/health/roles", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Failed (${res.status})`);
      setData(body as RolesPayload);
      const found = (body as RolesPayload).detected ?? 0;
      setNote(
        `Re-read ${found} tracker${found === 1 ? "" : "s"}. Anything it got wrong you can change below, and your change wins.`
      );
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't run the detection");
    } finally {
      setBusy(null);
    }
  }

  async function setRole(trackerId: string, value: string) {
    setBusy(trackerId);
    setError("");
    setNote("");
    try {
      const body =
        value === "__auto"
          ? { trackerId, clear: true }
          : value === "__none"
            ? { trackerId, role: null }
            : { trackerId, role: value };
      const res = await fetch("/api/health/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer = await res.json().catch(() => null);
      if (!res.ok) throw new Error(answer?.error || `Failed (${res.status})`);
      setData(answer as RolesPayload);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change it");
    } finally {
      setBusy(null);
    }
  }

  // Everything computed before the first early return — see check:shape.
  const byTracker = new Map((data?.assignments ?? []).map((a) => [a.trackerId, a]));
  const named = data?.trackers ?? [];
  const readCount = named.filter((t) => byTracker.has(t.id)).length;

  if (!data) {
    return (
      <section className="rounded-2xl border border-edge card p-5 shadow-md">
        <h2 className="font-semibold">What it read</h2>
        <p className="mt-1 text-sm text-secondary">
          {error || "Working out what your trackers mean…"}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-edge card p-5 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">What it read</h2>
          <p className="mt-1 text-sm text-secondary">
            You name your own trackers, so nothing here can assume a field
            called &ldquo;hydration&rdquo; exists. {readCount} of {named.length}{" "}
            are feeding the numbers above — <span className="tabular-nums">{data.coverage}%</span>{" "}
            of the kinds of input this page can use.
          </p>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2 sm:w-32">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${data.coverage}%` }}
          />
        </div>
      </div>

      {/* Said plainly rather than asked. It reads itself; the button only
          brings the next read forward. */}
      <div className="mt-4 rounded-lg border border-edge bg-surface-2 p-3">
        <p className="text-sm">
          <span className="font-medium">Read automatically</span>
          <span className="text-secondary">
            {" "}
            — the names are re-read whenever you add, rename or recategorise a
            tracker, and once a week otherwise. &ldquo;Baje khabar&rdquo; is
            junk food; &ldquo;Doom time&rdquo; is a screen.
          </span>
        </p>
        <p className="mt-1 text-xs text-muted">
          The model is shown names, types and categories only — never a value,
          never a note — and all it does is label them. Every number on this
          page is arithmetic on your own days either way.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted">
            {!data.aiConfigured
              ? "No AI key is set up, so this stays on keyword matching."
              : data.never
                ? "Not read yet — everything below was matched by name."
                : data.stale
                  ? "Your trackers changed; the next read will pick that up."
                  : data.ageDays === 0
                    ? "Read today."
                    : data.ageDays !== null
                      ? `Last read ${data.ageDays} day${data.ageDays === 1 ? "" : "s"} ago.`
                      : ""}
          </span>
          <button
            type="button"
            onClick={() => void detect()}
            disabled={busy !== null || !data.aiConfigured}
            className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-secondary hover:bg-surface-2 disabled:opacity-40"
          >
            {busy === "ai" ? "Reading…" : "Re-read now"}
          </button>
        </div>
        {note && <p className="mt-2 text-xs text-green-700 dark:text-green-500">{note}</p>}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-4 text-sm font-medium text-accent underline underline-offset-2"
      >
        {open ? "Hide the list" : `Show all ${named.length} trackers and fix any it got wrong`}
      </button>

      {open && (
        <ul className="mt-3 grid gap-2 lg:grid-cols-2">
          {named.map((t) => {
            const assignment = byTracker.get(t.id);
            const value = assignment?.role ?? "__none";
            return (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-surface-2 p-3"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className="block text-xs text-muted">
                    {t.type}
                    {t.unit ? ` · ${t.unit}` : ""}
                    {assignment && (
                      <>
                        {" · "}
                        <span
                          className={`rounded-full border px-1.5 py-0.5 ${SOURCE_STYLE[assignment.source]}`}
                        >
                          {SOURCE_LABEL[assignment.source]}
                        </span>{" "}
                        {assignment.why}
                      </>
                    )}
                  </span>
                </div>
                <Select
                  value={value}
                  label={`What ${t.name} measures`}
                  className="w-44 shrink-0"
                  buttonClassName="w-full text-sm"
                  onChange={(next) => void setRole(t.id, next)}
                  options={[
                    { value: "__none", label: "Not used" },
                    ...(assignment
                      ? [{ value: "__auto", label: "Let the app decide" }]
                      : []),
                    // Only the roles this tracker's type could actually fill —
                    // a 1-5 scale in the water slot would put a rating where a
                    // volume belongs, and the server refuses it anyway.
                    //
                    // No `hint`. Select draws the panel `min-w-max` and lays a
                    // hint out beside the label without wrapping, so a
                    // sentence-length one makes the dropdown wider than the
                    // page and takes the whole layout sideways with it. What
                    // each role feeds is explained in the list below instead,
                    // where there is room for a sentence.
                    ...data.roles
                      .filter((r) => r.types.length === 0 || r.types.includes(t.type))
                      .map((r) => ({ value: r.id, label: r.label })),
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}

      {data.missing.filter((r) => !r.quiet).length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold">Not enough trackers for these</h3>
          <p className="mt-1 text-sm text-secondary">
            Each one is left out of the scoring entirely rather than counted as
            a good day — which is why adding it changes the numbers above, and
            why it should.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.missing
              .filter((r) => !r.quiet)
              .slice(0, 6)
              .map((r) => (
                <li key={r.role} className="rounded-lg border border-edge bg-surface-2 p-3">
                  <Link
                    href="/trackers"
                    className="text-sm font-medium text-accent underline underline-offset-2"
                  >
                    {r.title}
                  </Link>
                  <p className="mt-1 text-sm text-secondary">{r.why}</p>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
