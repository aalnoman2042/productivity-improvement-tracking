import { PRAYERS, type PrayerKey } from "./prayers";

/**
 * When the five prayers actually are, for one place on one day.
 *
 * A namaz reminder set as five fixed clock times is wrong within weeks: in
 * Dhaka, Maghrib moves an hour and a half between June and December, and
 * Fajr nearly as much. So the times are computed rather than stored — from
 * the sun, which is what a waqt is defined by in the first place.
 *
 * Everything here is arithmetic: no network, no key, no clock of its own.
 * Give it a date, a latitude and longitude, and the minutes east of UTC that
 * the place keeps, and it returns "HH:MM" strings in that local time. The
 * astronomy is the standard low-precision solar position (Meeus via the
 * PrayTimes formulation) — good to well under a minute for these latitudes,
 * which is far finer than a reminder needs to be.
 *
 * What this deliberately does NOT do is add "precaution" minutes the way
 * printed calendars often do. A reminder is not a fatwa; it is a nudge, and
 * it has a three-hour grace window behind it (`lib/trackerReminders`).
 */

/* ------------------------------- degrees ------------------------------- */
// The astronomy is written in degrees end to end, because every constant in
// it is published in degrees. Converting once at each call keeps the
// formulas readable against the sources they came from.

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const dsin = (d: number) => Math.sin(rad(d));
const dcos = (d: number) => Math.cos(rad(d));
const dtan = (d: number) => Math.tan(rad(d));
const darcsin = (x: number) => deg(Math.asin(x));
const darccos = (x: number) => deg(Math.acos(x));
const darctan2 = (y: number, x: number) => deg(Math.atan2(y, x));
const darccot = (x: number) => deg(Math.atan(1 / x));

function wrap(a: number, b: number): number {
  const r = a - b * Math.floor(a / b);
  return r < 0 ? r + b : r;
}
const fixAngle = (a: number) => wrap(a, 360);
const fixHour = (h: number) => wrap(h, 24);

/* ------------------------------- methods ------------------------------- */

export type CalcMethod = "karachi" | "mwl" | "isna" | "egypt" | "makkah";
export type AsrSchool = "standard" | "hanafi";

/**
 * The twilight angles the sun has to reach for Fajr and Isha. They differ
 * because the authorities behind them measured different skies — this is a
 * choice a person makes, not a fact to be derived, which is why it is
 * offered rather than guessed.
 *
 * `isha` as a number is a depression angle; `{ afterMaghrib }` is the fixed
 * interval Umm al-Qura uses instead of one.
 */
export const CALC_METHODS: {
  value: CalcMethod;
  label: string;
  fajr: number;
  isha: number | { afterMaghrib: number };
}[] = [
  {
    value: "karachi",
    label: "Karachi / Islamic Foundation (18°, 18°)",
    fajr: 18,
    isha: 18,
  },
  { value: "mwl", label: "Muslim World League (18°, 17°)", fajr: 18, isha: 17 },
  { value: "isna", label: "ISNA, North America (15°, 15°)", fajr: 15, isha: 15 },
  { value: "egypt", label: "Egyptian Authority (19.5°, 17.5°)", fajr: 19.5, isha: 17.5 },
  {
    value: "makkah",
    label: "Umm al-Qura, Makkah (18.5°, 90 min)",
    fajr: 18.5,
    isha: { afterMaghrib: 90 },
  },
];

/** The subcontinent prays Asr by the Hanafi shadow, which is why it leads. */
export const ASR_SCHOOLS: { value: AsrSchool; label: string; factor: number }[] = [
  { value: "hanafi", label: "Hanafi (later Asr)", factor: 2 },
  { value: "standard", label: "Standard (earlier Asr)", factor: 1 },
];

/** Where someone prays, and by whose reckoning. */
export type PrayerPlace = {
  lat: number;
  lon: number;
  /** Free text for the UI only — "Dhaka". Never used in the arithmetic. */
  label?: string | null;
  method?: CalcMethod;
  asr?: AsrSchool;
};

export type PrayerSlot = {
  key: PrayerKey;
  label: string;
  /** Local time of day, "HH:MM". */
  time: string;
};

/* ------------------------------ the sun -------------------------------- */

/** Julian day number for midnight UT of a "YYYY-MM-DD". */
function julianDay(date: string): number {
  let year = Number(date.slice(0, 4));
  let month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (year + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day +
    b -
    1524.5
  );
}

/** Declination (degrees) and equation of time (hours) for a Julian day. */
function sunPosition(jd: number): { decl: number; eqt: number } {
  const d = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * d); // mean anomaly
  const q = fixAngle(280.459 + 0.98564736 * d); // mean longitude
  const l = fixAngle(q + 1.915 * dsin(g) + 0.02 * dsin(2 * g)); // ecliptic longitude
  const e = 23.439 - 0.00000036 * d; // obliquity
  const ra = fixHour(darctan2(dcos(e) * dsin(l), dcos(l)) / 15);
  return { decl: darcsin(dsin(e) * dsin(l)), eqt: q / 15 - ra };
}

/**
 * The engine works in "hours from local midnight at this longitude", and
 * only shifts to the wall clock at the very end — the standard way to do
 * this, and the reason the same code is right in Dhaka and in Reykjavík.
 */
type Ctx = { jd: number; lat: number };

/** Solar noon, in local mean hours. */
function midDay(ctx: Ctx, t: number): number {
  return fixHour(12 - sunPosition(ctx.jd + t).eqt);
}

/**
 * When the sun sits `angle` degrees below the horizon, before noon (`ccw`)
 * or after it. NaN at latitudes where it never gets there — a real answer,
 * and the caller's cue to fall back rather than invent one.
 */
function sunAngleTime(ctx: Ctx, angle: number, t: number, ccw: boolean): number {
  const { decl } = sunPosition(ctx.jd + t);
  const noon = midDay(ctx, t);
  const cos =
    (-dsin(angle) - dsin(decl) * dsin(ctx.lat)) / (dcos(decl) * dcos(ctx.lat));
  const hours = darccos(cos) / 15;
  return noon + (ccw ? -hours : hours);
}

/** Asr: when a thing's shadow is `factor` times its length, plus noon shadow. */
function asrTime(ctx: Ctx, factor: number, t: number): number {
  const { decl } = sunPosition(ctx.jd + t);
  const angle = -darccot(factor + dtan(Math.abs(ctx.lat - decl)));
  return sunAngleTime(ctx, angle, t, false);
}

/** "HH:MM" from an hour count, rounded to the nearest minute. */
function clock(hours: number): string {
  const total = Math.round(wrap(hours, 24) * 60);
  // 23:59:40 rounds to 24:00, which is midnight of a day this is not about.
  const m = total % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/* ------------------------------- the API ------------------------------- */

/**
 * The five prayer times for a day, or null when the sun refuses to answer —
 * inside the polar circles there are days with no true Fajr or Isha, and a
 * made-up time is worse than the fixed times the caller already has.
 *
 * `tzOffset` is minutes east of UTC (+360 for UTC+6), the same field the
 * reminder schedule already keeps for every user.
 */
export function prayerTimesFor(
  date: string,
  place: PrayerPlace,
  tzOffset: number
): PrayerSlot[] | null {
  const method =
    CALC_METHODS.find((m) => m.value === place.method) ?? CALC_METHODS[0];
  const asr = ASR_SCHOOLS.find((a) => a.value === place.asr) ?? ASR_SCHOOLS[0];

  // The longitude correction turns UT into mean solar time where they are;
  // adding it back at the end turns the answer into their wall clock.
  const ctx: Ctx = { jd: julianDay(date) - place.lon / (15 * 24), lat: place.lat };

  // Seeded with rough times and refined: the sun moves during the day being
  // solved for, so each time is recomputed at its own hour. Two passes is
  // past the point where a third changes a rounded minute.
  let fajr = 5 / 24;
  let dhuhr = 12 / 24;
  let asrT = 13 / 24;
  let maghrib = 18 / 24;
  let isha = 18 / 24;

  for (let pass = 0; pass < 2; pass++) {
    fajr = sunAngleTime(ctx, method.fajr, fajr, true) / 24;
    dhuhr = midDay(ctx, dhuhr) / 24;
    asrT = asrTime(ctx, asr.factor, asrT) / 24;
    // Maghrib is sunset: the sun's upper limb at 0.833° below the horizon,
    // which is refraction plus its own radius.
    maghrib = sunAngleTime(ctx, 0.833, maghrib, false) / 24;
    isha =
      typeof method.isha === "number"
        ? sunAngleTime(ctx, method.isha, isha, false) / 24
        : maghrib + method.isha.afterMaghrib / (60 * 24);
  }

  const shift = tzOffset / 60 - place.lon / 15;
  const hours = [fajr, dhuhr, asrT, maghrib, isha].map((t) => t * 24 + shift);
  if (hours.some((h) => !Number.isFinite(h))) return null;

  const order: PrayerKey[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
  return order.map((key, i) => ({
    key,
    label: PRAYERS.find((p) => p.key === key)!.label,
    time: clock(hours[i]),
  }));
}

/**
 * Validate a place off the wire. Everything optional falls back to the
 * subcontinent's reckoning, which is whose app this is.
 */
export function parsePlace(raw: unknown): PrayerPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) return null;

  const method = CALC_METHODS.find((m) => m.value === p.method)?.value ?? "karachi";
  const asr = ASR_SCHOOLS.find((a) => a.value === p.asr)?.value ?? "hanafi";
  const label =
    typeof p.label === "string" && p.label.trim()
      ? p.label.trim().slice(0, 60)
      : null;

  // Rounded to about ten metres: finer than that is someone's address, and
  // the prayer times don't change over a street.
  return {
    lat: Math.round(lat * 10000) / 10000,
    lon: Math.round(lon * 10000) / 10000,
    label,
    method,
    asr,
  };
}

/** A few places to start from, so nobody has to type coordinates. */
export const PLACE_PRESETS: (PrayerPlace & { label: string })[] = [
  { label: "Dhaka", lat: 23.8103, lon: 90.4125 },
  { label: "Chattogram", lat: 22.3569, lon: 91.7832 },
  { label: "Sylhet", lat: 24.8949, lon: 91.8687 },
  { label: "Khulna", lat: 22.8456, lon: 89.5403 },
  { label: "Rajshahi", lat: 24.3745, lon: 88.6042 },
  { label: "Makkah", lat: 21.4225, lon: 39.8262 },
  { label: "London", lat: 51.5072, lon: -0.1276 },
  { label: "New York", lat: 40.7128, lon: -74.006 },
];
