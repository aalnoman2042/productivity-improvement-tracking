import { DAY_MINUTES, MAX_NAPS, type Nap } from "./draft";
import { PRAYER_KEYS, orderPrayers } from "./prayers";

const HHMM = /^\d{2}:\d{2}$/;

/**
 * The extras an entry can carry: sleep clock times and the day's naps, which
 * of the five prayers were prayed, and whether a clean-streak day was clean
 * or a slip.
 * Returns null when there's nothing worth storing.
 *
 * Shared by the daily-save route and the backup import, so a file restored
 * from an export passes through exactly the same sieve as a day typed in.
 */
export function parseMeta(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;

  const start = typeof m.start === "string" && HHMM.test(m.start) ? m.start : null;
  const end = typeof m.end === "string" && HHMM.test(m.end) ? m.end : null;
  const q = Number(m.quality);
  const quality = Number.isFinite(q) && q >= 1 && q <= 5 ? Math.round(q) : null;

  const named: string[] = [];
  if (Array.isArray(m.parts)) {
    for (const p of m.parts) {
      if (typeof p === "string" && PRAYER_KEYS.includes(p)) named.push(p);
    }
  }
  const parts = orderPrayers(named);

  // Naps. Each is real minutes, so nothing under one and nothing longer than
  // the day; `at` is the clock time a nap timer began, and is simply absent
  // for one typed in after the fact.
  const naps: Nap[] = [];
  if (Array.isArray(m.naps)) {
    for (const item of m.naps) {
      if (naps.length >= MAX_NAPS) break;
      if (!item || typeof item !== "object") continue;
      const n = item as Record<string, unknown>;
      const mins = Math.round(Number(n.mins));
      if (!Number.isFinite(mins) || mins < 1 || mins > DAY_MINUTES) continue;
      naps.push({
        mins,
        at: typeof n.at === "string" && HHMM.test(n.at) ? n.at : null,
      });
    }
  }

  const status = m.status === "clean" || m.status === "slip" ? m.status : null;

  if (!start && !end && !quality && naps.length === 0 && parts.length === 0 && !status) {
    return null;
  }
  return {
    start,
    end,
    quality,
    naps: naps.length > 0 ? naps : null,
    parts: parts.length > 0 ? parts : null,
    status,
  };
}
