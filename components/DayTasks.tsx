"use client";

import { useState } from "react";
import { addDays, toDateStr } from "@/lib/dates";
import { cacheSet, post } from "@/lib/sync";
import { useCached } from "@/lib/useCached";
import {
  MAX_TASK,
  MAX_TASKS_PER_DAY,
  inOrder,
  nextOrder,
  taskHeading,
  taskProgress,
  taskSummary,
  type Task,
} from "@/lib/tasks";

/**
 * Have to do it today.
 *
 * The rest of this page is a record of what happened; this is the one part
 * of it that faces forward. It sits at the top for that reason — the answer
 * to "what was I supposed to do before midnight?" is worth more at 9am than
 * anything below it, and by 11pm it is the thing you check before sleeping.
 *
 * Nothing here touches a number. No score, no streak, no grade, and the
 * coach never sees it: ticked boxes are words someone wrote, and this app
 * promises out loud that its AI reads numbers and tracker names only.
 *
 * Every write is optimistic and goes through the offline queue. A checkbox
 * that needs a signal is a checkbox that fails while you are out doing the
 * thing it is about, so the tick lands immediately and the network catches
 * up whenever it can.
 */

type Day = { date: string; tasks: Task[] };

export default function DayTasks({ date }: { date: string }) {
  const key = `tasks:${date}`;
  const q = useCached<Day>(`/api/tasks?date=${date}`, key);
  const tasks = inOrder(q.data?.tasks ?? []);

  // Read once, in an initializer: a clock in render is impure, and the
  // heading only needs to know which day it was opened on.
  const [today] = useState(() => toDateStr(new Date()));
  const ahead = date > today;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** Paint the new list at once, and keep the cache in step with it. */
  function apply(next: Task[]) {
    q.update({ date, tasks: inOrder(next) });
    cacheSet(key, { date, tasks: inOrder(next) });
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    if (tasks.length >= MAX_TASKS_PER_DAY) {
      setError(`That's ${MAX_TASKS_PER_DAY} things for one day — enough to be going on with`);
      return;
    }
    setBusy(true);
    setError("");
    // A temporary id so the row can appear before the server has named it;
    // the refresh below replaces it with the real one.
    const temp: Task = {
      id: `new-${nextOrder(tasks)}-${value.length}`,
      text: value,
      done: false,
      order: nextOrder(tasks),
    };
    apply([...tasks, temp]);
    setText("");
    try {
      await post("/api/tasks", { date, text: value });
      await q.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that");
      apply(tasks);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(task: Task) {
    const next = !task.done;
    apply(tasks.map((t) => (t.id === task.id ? { ...t, done: next } : t)));
    try {
      await post(`/api/tasks/${task.id}`, { done: next });
    } catch {
      // Put the tick back where it was: a checkbox that lies is worse than
      // one that refuses.
      apply(tasks);
      setError("Couldn't save that — try again");
    }
  }

  async function remove(task: Task) {
    apply(tasks.filter((t) => t.id !== task.id));
    try {
      await post(`/api/tasks/${task.id}`, { remove: true });
    } catch {
      apply(tasks);
      setError("Couldn't remove that — try again");
    }
  }

  const { cleared } = taskProgress(tasks);

  return (
    <section className="rounded-xl border border-edge card p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold">✅ {taskHeading(date, today, addDays(today, 1))}</h2>
        <span
          className={`text-xs ${cleared ? "font-medium text-green-700 dark:text-green-500" : "text-muted"}`}
        >
          {taskSummary(tasks)}
        </span>
      </div>

      {tasks.length > 0 && (
        <ul className="mt-3 space-y-1">
          {tasks.map((task) => (
            <li key={task.id} className="group flex items-start gap-2">
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 py-1">
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={() => void toggle(task)}
                  className="mt-0.5 h-4.5 w-4.5 shrink-0 accent-[var(--accent)]"
                />
                <span
                  className={`min-w-0 text-sm break-words ${
                    task.done ? "text-muted line-through" : ""
                  }`}
                >
                  {task.text}
                </span>
              </label>
              <button
                type="button"
                onClick={() => void remove(task)}
                aria-label={`Remove "${task.text}"`}
                className="shrink-0 rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            ahead ? "Add something for that day…" : "Add something you have to do…"
          }
          maxLength={MAX_TASK}
          aria-label={ahead ? "Add a task for that day" : "Add a task for today"}
          className="min-w-0 flex-1 rounded-lg border border-edge bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-lg border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2 disabled:opacity-40"
        >
          Add
        </button>
      </form>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {tasks.length === 0 && !error && (
        <p className="mt-2 text-xs text-muted">
          {ahead
            ? "Decide it now, tick it then. None of this counts towards your score, your streaks or anything the coach reads."
            : "Just for you — none of this counts towards your score, your streaks or anything the coach reads."}
        </p>
      )}
    </section>
  );
}
