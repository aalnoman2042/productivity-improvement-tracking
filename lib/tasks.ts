/**
 * The things you have to do today.
 *
 * A tracker asks the same question every day — "how long did you study?" —
 * and that is what makes it worth charting. A task is the opposite: one
 * thing, once, and then it is over. "Submit the form", "call the bank".
 * Charting it would be meaningless, and so, deliberately, is:
 *
 * **A task never touches a number.** Not the day score, not days logged, not
 * a streak, not a grade, and it is never shown to the AI — the coach sees
 * numbers and tracker names only, which is a promise the welcome page makes
 * out loud, and a to-do list is words someone wrote. The same reasoning that
 * keeps notes out of the scoring keeps tasks out of it: a day with three
 * ticked boxes and nothing logged is still a day with nothing logged.
 *
 * What a task IS for is the hour you open the app and cannot remember what
 * you meant to do before midnight.
 */

/** One line, not a paragraph. A task that needs more room is two tasks. */
export const MAX_TASK = 140;

/**
 * Twenty is already more than a day holds. The cap is not really about
 * storage — it is about the list staying a list of things you will actually
 * do, rather than becoming a backlog with a date on it.
 */
export const MAX_TASKS_PER_DAY = 20;

export type Task = {
  id: string;
  text: string;
  done: boolean;
  /** Position in the day's list. Insertion order, and it stays that way. */
  order: number;
};

/** Trim and bound an incoming task; null means "that isn't a task". */
export function cleanTask(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ").slice(0, MAX_TASK);
  return text ? text : null;
}

/**
 * The list in the order it is shown: as written, with the done ones left
 * exactly where they are.
 *
 * Sinking a ticked item to the bottom is the fashionable choice and the
 * wrong one here — the list moves under your finger at the exact moment you
 * are touching it, and on a phone that means the next tap lands on something
 * you did not mean. A line through it says "done" just as clearly and the
 * list holds still.
 */
export function inOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Where a new task goes: after everything already there. */
export function nextOrder(tasks: Task[]): number {
  return tasks.reduce((max, t) => Math.max(max, t.order), -1) + 1;
}

/**
 * What to call the list, given the day it belongs to.
 *
 * "Have to do it today" is wrong on every day that isn't today, and the
 * section is reachable for tomorrow (to plan) and for past days (to look).
 * The wording carries the tense so the heading never lies about which day
 * is open.
 */
export function taskHeading(date: string, today: string, tomorrow: string): string {
  if (date === today) return "Have to do it today";
  if (date === tomorrow) return "Have to do it tomorrow";
  // A day further out than tomorrow isn't reachable from the log today, but
  // a heading that says "tomorrow" about next Thursday would be a small lie
  // waiting for the day someone links straight to it.
  if (date > today) return "Have to do it that day";
  return "Had to do that day";
}

export type TaskProgress = {
  done: number;
  total: number;
  /** True only when there was something to finish and it is all finished. */
  cleared: boolean;
};

export function taskProgress(tasks: Task[]): TaskProgress {
  const done = tasks.filter((t) => t.done).length;
  return { done, total: tasks.length, cleared: tasks.length > 0 && done === tasks.length };
}

/**
 * What the section says about itself in one line.
 *
 * Never scolds. A day with four things left on it at 11pm is not a failure
 * worth a red number — the rest of this app already tells you when you are
 * behind, and it does it from numbers you agreed to be measured on.
 */
export function taskSummary(tasks: Task[]): string {
  const { done, total, cleared } = taskProgress(tasks);
  if (total === 0) return "Nothing on the list yet";
  if (cleared) return total === 1 ? "Done" : `All ${total} done`;
  return `${done} of ${total} done`;
}
