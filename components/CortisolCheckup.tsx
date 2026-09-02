"use client";

import { useMemo, useState } from "react";
import { toDateStr } from "@/lib/dates";
import {
  QUESTIONS,
  SECTIONS,
  missingFrom,
  monthTitle,
  type Answers,
  type AnswerValue,
  type Question,
} from "@/lib/cortisolCheck";

/**
 * The monthly check-up.
 *
 * Rendered entirely from `QUESTIONS`, so the form and the scoring are one
 * list rather than two that have to be kept in step — adding a question is a
 * line of data, and it turns up here and in the score at the same moment.
 *
 * **Every question is required**, and the reason is comparability: a partly
 * filled sheet scores perfectly well, which means two people — or the same
 * person in two different months — can hold the same number while one
 * answered everything and the other answered only what flattered them. All
 * of it, or no output.
 *
 * That makes the design job finishing it. Thirty questions is a lot to ask
 * once a month and far too much to ask badly, so: the count left is always on
 * screen, every unanswered question is marked in place rather than announced
 * at the end, the button says how many remain instead of just going grey, and
 * last month's answers arrive pre-filled — most of these barely move, and
 * retyping thirty of them is how a monthly check-up becomes a never check-up.
 */
export default function CortisolCheckup({
  month,
  initial,
  prefilledFrom,
  onSaved,
  onCancel,
}: {
  month: string;
  initial: Answers;
  prefilledFrom: string | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [answers, setAnswers] = useState<Answers>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const missing = useMemo(() => missingFrom(answers), [answers]);
  const missingIds = useMemo(() => new Set(missing.map((q) => q.id)), [missing]);
  const answered = QUESTIONS.length - missing.length;
  const complete = missing.length === 0;

  function set(id: string, value: AnswerValue | undefined) {
    setError("");
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined || value === "") delete next[id];
      else next[id] = value;
      return next;
    });
  }

  function toggle(id: string, value: string) {
    const current = Array.isArray(answers[id]) ? (answers[id] as string[]) : [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    set(id, next.length > 0 ? next : undefined);
  }

  async function save() {
    if (busy || !complete) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cortisol/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ today: toDateStr(new Date()), answers }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't save — check your connection");
        return;
      }
      onSaved();
    } catch {
      setError("Couldn't save — check your connection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-edge card p-5 shadow-md">
        <h2 className="text-lg font-semibold">
          {monthTitle(month)} check-up
        </h2>
        <p className="mt-1 text-sm text-secondary">
          Once a month, because these answers move slowly and the daily log
          cannot see any of them. <strong>All of it is required</strong> — a
          half-filled sheet still produces a number, and a number built from
          whichever questions happened to flatter you is worse than none.
        </p>
        {prefilledFrom && (
          <p className="mt-2 text-sm text-secondary">
            Filled in from your {monthTitle(prefilledFrom)} answers. Change
            what has moved and leave the rest.
          </p>
        )}
        <p className="mt-3 text-sm font-medium tabular-nums">
          {answered} of {QUESTIONS.length} answered
          {!complete && (
            <span className="font-normal text-amber-700 dark:text-amber-500">
              {" "}
              · {missing.length} to go
            </span>
          )}
        </p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full transition-[width] ${
              complete ? "bg-green-600" : "bg-accent"
            }`}
            style={{ width: `${(answered / QUESTIONS.length) * 100}%` }}
          />
        </div>
      </div>

      {SECTIONS.map((section) => {
        const questions = QUESTIONS.filter((q) => q.section === section.id);
        if (questions.length === 0) return null;
        return (
          <section
            key={section.id}
            className="rounded-2xl border border-edge card p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{section.title}</h3>
              {questions.some((q) => missingIds.has(q.id)) && (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-500">
                  {questions.filter((q) => missingIds.has(q.id)).length} unanswered
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-secondary">{section.blurb}</p>
            <div className="mt-4 space-y-5">
              {questions.map((q) => (
                <Field
                  key={q.id}
                  q={q}
                  value={answers[q.id]}
                  missing={missingIds.has(q.id)}
                  onChange={(v) => set(q.id, v)}
                  onToggle={(v) => toggle(q.id, v)}
                />
              ))}
            </div>
          </section>
        );
      })}

      <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-xl border border-edge card p-3 shadow-md">
        <button
          type="button"
          onClick={save}
          disabled={busy || !complete}
          className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy
            ? "Saving…"
            : complete
              ? "Save this month's check-up"
              : `${missing.length} still to answer`}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2"
          >
            Cancel
          </button>
        )}
        {error && <span className="text-sm font-medium text-red-600">{error}</span>}
      </div>
    </div>
  );
}

/* ------------------------------ one question ---------------------------- */

function Field({
  q,
  value,
  missing,
  onChange,
  onToggle,
}: {
  q: Question;
  value: AnswerValue | undefined;
  missing: boolean;
  onChange: (v: AnswerValue | undefined) => void;
  onToggle: (v: string) => void;
}) {
  const chosen = Array.isArray(value) ? value : [];

  return (
    <div
      className={
        missing
          ? "-mx-2 rounded-lg border-l-2 border-amber-500 px-2 py-1"
          : undefined
      }
    >
      <p className="text-sm font-medium">
        {q.text}
        {missing && (
          <span
            className="ml-1 text-amber-700 dark:text-amber-500"
            aria-label="unanswered"
          >
            *
          </span>
        )}
      </p>
      {q.help && <p className="mt-0.5 text-xs text-muted">{q.help}</p>}

      {(q.kind === "choice" || q.kind === "multi" || q.kind === "flags") && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {q.options.map((o) => {
            const on =
              q.kind === "choice" ? value === o.value : chosen.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  q.kind === "choice"
                    ? onChange(on ? undefined : o.value)
                    : onToggle(o.value)
                }
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  on
                    ? "border-accent bg-accent text-white"
                    : "border-edge text-secondary hover:border-accent hover:text-accent"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      {q.kind === "scale" && (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).map(
              (n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={value === n}
                  onClick={() => onChange(value === n ? undefined : n)}
                  className={`h-9 w-9 rounded-md border text-sm tabular-nums transition-colors ${
                    value === n
                      ? "border-accent bg-accent text-white"
                      : "border-edge text-secondary hover:border-accent hover:text-accent"
                  }`}
                >
                  {n}
                </button>
              )
            )}
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted">
            <span>{q.lowLabel}</span>
            <span>{q.highLabel}</span>
          </div>
        </div>
      )}

      {q.kind === "number" && (
        <div className="mt-2 flex items-center gap-2">
          <input
            inputMode="decimal"
            value={value === undefined ? "" : String(value)}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9.]/g, "").slice(0, 6);
              onChange(raw === "" ? undefined : Number(raw));
            }}
            placeholder="—"
            aria-label={q.text}
            className="w-24 rounded-md border border-edge bg-transparent px-3 py-2 text-right outline-none focus:border-accent"
          />
          <span className="text-sm text-muted">{q.unit}</span>
        </div>
      )}
    </div>
  );
}
