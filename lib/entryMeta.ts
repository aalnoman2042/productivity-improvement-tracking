import { PRAYER_KEYS, orderPrayers } from "./prayers";

const HHMM = /^\d{2}:\d{2}$/;

/**
 * The extras an entry can carry: sleep clock times, which of the five prayers
 * were prayed, and whether a clean-streak day was clean or a slip.
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

  const status = m.status === "clean" || m.status === "slip" ? m.status : null;

  if (!start && !end && !quality && parts.length === 0 && !status) return null;
  return { start, end, quality, parts: parts.length > 0 ? parts : null, status };
}
