import { prettyDate } from "./dates";

/**
 * The message an admin can put on somebody's phone, right now.
 *
 * The nightly ask belongs to a schedule and to a switch the reader owns;
 * this is the other thing — one message, sent by hand, because somebody has
 * stopped logging and the app has no other way to say so. It deliberately
 * does not consult `reminder.enabled`: that switch decides whether the app
 * pesters you every night on its own, and a person who turned it off has not
 * asked to be unreachable. **The permission granted to the browser is the
 * gate** — no subscription, nothing sent, and the admin is told so.
 *
 * Everything here is pure. What it decides is only how one message is *set*:
 * a notification is a headline and a line under it, and a message typed as
 * one sentence has to be cut in two somewhere.
 */

/** What the box starts with — the owner's own words. */
export const DEFAULT_NUDGE = "Log your day now — I'll predict your life.";

/** A notification is two short lines on a lock screen, never a paragraph. */
export const MAX_NUDGE = 140;

/** Where a message that never breaks ends up, matching `sw.js`'s own default. */
const FALLBACK_TITLE = "Log your day";

/** A headline longer than this is not a headline. */
const MAX_TITLE = 60;

/** Whitespace collapsed, ends trimmed, capped. Null when nothing is left. */
export function cleanNudge(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.slice(0, MAX_NUDGE).trim();
}

/** Separators someone types when they mean "headline, then the rest". */
const BREAKS = ["—", "–", " - ", "|"];

/**
 * Cut one typed message into the headline and the line under it.
 *
 * The first dash-or-pipe wins, otherwise the first full stop — the same idea
 * as `lib/answerFormat`'s verdict sentence, and for the same reason: the top
 * line is the only part read at a glance.
 */
export function splitMessage(text: string): { title: string; body: string } {
  let at = -1;
  let skip = 0;

  for (const mark of BREAKS) {
    const i = text.indexOf(mark);
    if (i > 0 && (at < 0 || i < at)) {
      at = i;
      skip = mark.length;
    }
  }

  for (let i = 0; i < text.length - 1; i++) {
    const ch = text[i];
    if ((ch === "." || ch === "!" || ch === "?") && text[i + 1] === " ") {
      // The stop belongs to the sentence it ends, so the title keeps it.
      if (at < 0 || i + 1 < at) {
        at = i + 1;
        skip = 1;
      }
      break;
    }
  }

  const title = (at < 0 ? text : text.slice(0, at)).trim();
  const body = (at < 0 ? "" : text.slice(at + skip)).trim();

  // A message that is all one long clause has no headline in it; inventing
  // one would put words in the sender's mouth, so the app's own default
  // takes the top line and every typed word survives underneath.
  if (!title || title.length > MAX_TITLE) {
    return { title: FALLBACK_TITLE, body: text.trim() };
  }
  return { title, body };
}

export type NudgePayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

/**
 * The push itself. It lands on the day the reader is living — the tap has to
 * open the log they were asked to fill in, not the one the server is on.
 *
 * The tag is the day, so a second nudge replaces the first rather than
 * stacking; and it is *not* the daily ask's tag, so a nudge at noon can
 * never swallow the ask at eleven.
 */
export function nudgePayload(message: string, date: string): NudgePayload {
  const { title, body } = splitMessage(message);
  return {
    title,
    body: body || `Tap to log ${prettyDate(date)}.`,
    url: `/?date=${date}`,
    tag: `pit-nudge-${date}`,
  };
}
