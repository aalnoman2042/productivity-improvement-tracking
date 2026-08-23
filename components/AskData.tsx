"use client";

import { useState } from "react";
import { toDateStr } from "@/lib/dates";
import { segments, shapeAnswer } from "@/lib/answerFormat";

/**
 * A question box pointed at your own numbers.
 *
 * The coach answers the question the app decided to ask, once every eight
 * hours. This answers the one you actually have, now — which is the gap the
 * owner named: plenty of data, no way to get a decision out of it without
 * reading six charts and doing the arithmetic yourself.
 *
 * The answer arrives as prose and is *set* rather than printed: the opening
 * sentence is the verdict (the prompt guarantees it comes first), the figures
 * inside are found and given weight, and the rest is support. See
 * `lib/answerFormat` — none of it changes a word, it only decides what gets
 * to be large. A wall of grey text would have been the same problem as the
 * charts.
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

/** The same words, with the numbers in them allowed to carry weight. */
function Figures({ text, tone }: { text: string; tone: "lead" | "body" }) {
  return (
    <>
      {segments(text).map((s, i) =>
        s.number ? (
          <span
            key={i}
            className={
              tone === "lead"
                ? "font-bold text-accent"
                : "font-semibold text-foreground"
            }
          >
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}

function Answer({ text }: { text: string }) {
  const { lead, body } = shapeAnswer(text);
  return (
    <div className="space-y-2">
      {/* The first sentence is the answer — the prompt promises it, so it is
          set like one instead of being the start of a paragraph. */}
      <p className="text-base leading-snug font-semibold">
        <Figures text={lead} tone="lead" />
      </p>
      {body.map((paragraph, i) => (
        <p key={i} className="text-sm leading-relaxed text-secondary">
          <Figures text={paragraph} tone="body" />
        </p>
      ))}
    </div>
  );
}

export default function AskData() {
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState("");
  const [error, setError] = useState("");

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setAsking(q);
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
      setAsking("");
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

      {/* The question being read, in the shape its answer will take — so the
          card doesn't jump when the words land. */}
      {busy && (
        <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3">
          <p className="text-xs font-medium text-accent">{asking}</p>
          <div className="mt-2.5 space-y-2" aria-hidden="true">
            <div className="skeleton h-4 w-3/4 rounded" />
            <div className="skeleton h-3 w-full rounded" />
            <div className="skeleton h-3 w-5/6 rounded" />
          </div>
          <span className="sr-only">Reading your numbers…</span>
        </div>
      )}

      {thread.length > 0 && (
        <ul className="mt-4 space-y-3">
          {thread.map((x, i) => (
            <li
              key={i}
              className={`animate-fade-in overflow-hidden rounded-lg border ${
                // The newest answer is the one being read; the ones above it
                // are history, and shouldn't compete with it for the eye.
                i === 0 ? "border-accent/40 bg-accent/5" : "border-edge bg-surface-2"
              }`}
            >
              <div className="flex items-start gap-2 border-b border-edge/60 px-3 py-2">
                <span
                  aria-hidden="true"
                  className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold text-accent"
                >
                  ?
                </span>
                <p className="min-w-0 text-xs font-medium text-secondary">
                  {x.question}
                </p>
              </div>
              <div className="px-3 py-2.5">
                <Answer text={x.answer} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
