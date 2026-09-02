"use client";

import { useState } from "react";
import { SEXES, type CortisolProfile as Profile } from "@/lib/cortisol";

/**
 * The three things the day's log cannot know.
 *
 * Age and sex are here because the awakening response genuinely moves with
 * them — it flattens across adult life, and differs a little between sexes —
 * so a curve drawn without them is drawn for a thirty-year-old whether or not
 * one is reading it. Mood is here because a persistently low one tracks a
 * flatter evening slope, and because it is the one input the trackers may
 * have no answer for.
 *
 * All three are optional and all three can be cleared. Each simply drops out
 * of the weighting when it is absent, rather than being guessed at — an
 * assumed age is a worse input than no age.
 *
 * Mood typed here is only the fallback: on any day a mood tracker was
 * actually logged, that day's own rating wins.
 */
export default function CortisolProfile({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: (next: Profile) => void;
}) {
  const [age, setAge] = useState(profile.age === null ? "" : String(profile.age));
  const [sex, setSex] = useState<string>(profile.sex ?? "");
  const [mood, setMood] = useState(profile.mood === null ? "" : String(profile.mood));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    setSaved(false);
    try {
      const res = await fetch("/api/cortisol", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          age: age === "" ? null : Number(age),
          sex: sex === "" ? null : sex,
          mood: mood === "" ? null : Number(mood),
        }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { profile: Profile };
      setSaved(true);
      onSaved(body.profile);
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-md border border-edge bg-transparent px-3 py-2 outline-none focus:border-accent";

  return (
    <div className="rounded-xl border border-edge card p-4 shadow-sm">
      <h2 className="font-semibold">About you</h2>
      <p className="mt-1 text-sm text-secondary">
        Three things your trackers cannot record. Every one is optional — left
        blank, it is left out of the model rather than guessed at.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm text-secondary">Age</span>
          <input
            inputMode="numeric"
            value={age}
            onChange={(e) => {
              setSaved(false);
              setAge(e.target.value.replace(/[^0-9]/g, "").slice(0, 3));
            }}
            placeholder="—"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-secondary">Sex</span>
          <select
            value={sex}
            onChange={(e) => {
              setSaved(false);
              setSex(e.target.value);
            }}
            className={field}
          >
            <option value="">—</option>
            {SEXES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-secondary">
            Usual mood, 1–5
          </span>
          <select
            value={mood}
            onChange={(e) => {
              setSaved(false);
              setMood(e.target.value);
            }}
            className={field}
          >
            <option value="">—</option>
            <option value="1">1 — low</option>
            <option value="2">2</option>
            <option value="3">3 — even</option>
            <option value="4">4</option>
            <option value="5">5 — high</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {saved && (
          <span className="animate-fade-in text-sm font-medium text-green-700 dark:text-green-500">
            Saved — the curve below is redrawn.
          </span>
        )}
      </div>
    </div>
  );
}
