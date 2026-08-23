"use client";

import { useState } from "react";
import { toDateStr } from "@/lib/dates";

/**
 * A question box pointed at your own numbers.
 *
 * The coach answers the question the app decided to ask, once every eight
 * hours. This answers the one you actually have, now — which is the gap the
 * owner named: plenty of data, no way to get a decision out of it without
 * reading six charts and doing the arithmetic yourself.
 *
 * Answers are not stored. What you asked stays on this screen until you
 * leave it, deliberately: the eight-hour read is the thing the app keeps a
 * record of, and a question is a conversation.
 */

/** Openers, because a blank box is harder to answer than a question is. */
const SUGGESTIONS = [
  "What is dragging my score down?",
  "Is my sleep affecting my study?",
  "Which day of the week do I fall apart?",
  "What am I doing better than last week?",
];

type Exchange = { question: string; answer: string };

export default function AskData() {
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/coach/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, today: toDateStr(new Date()) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Couldn't answer that — try again");
        return;
      }
      // Newest first: the answer you just asked for should not be at the
      // bottom of a growing list.
      setThread((t) => [{ question: q, answer: String(data.answer) }, ...t]);
      setQuestion("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-edge card p-4 shadow-sm">
      <h2 className="font-semibold">💬 Ask your data</h2>
      <p className="mt-1 text-sm text-secondary">
        A question about your own numbers, answered from them alone. It reads
        the same figures the coach does — never anything you wrote.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Why is my score down this week?"
          maxLength={300}
          aria-label="Ask a question about your data"
          className="min-w-0 flex-1 rounded-lg border border-edge bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || question.trim().length < 3}
          className="shrink-0 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "Reading…" : "Ask"}
        </button>
      </form>

      {thread.length === 0 && !busy && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="rounded-md border border-edge px-2.5 py-1 text-xs text-secondary hover:bg-surface-2"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {thread.length > 0 && (
        <ul className="mt-4 space-y-3">
          {thread.map((x, i) => (
            <li key={i} className="rounded-lg border border-edge bg-surface-2 p-3">
              <p className="text-xs font-medium text-muted">{x.question}</p>
              <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap">
                {x.answer}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
