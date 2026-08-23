import { describe, expect, it } from "vitest";
import {
  CALC_METHODS,
  parsePlace,
  prayerTimesFor,
  type PrayerPlace,
} from "../lib/prayerTimes";

/**
 * The engine is pinned to the sun, not to a printed calendar: the assertions
 * below are checked against published sunrise/sunset for each city, with a
 * few minutes of slack. Printed prayer calendars often add "precaution"
 * minutes on top, which is a choice about caution rather than about
 * astronomy — so they are not what this is measured against.
 */

const DHAKA: PrayerPlace = {
  lat: 23.8103,
  lon: 90.4125,
  method: "karachi",
  asr: "hanafi",
};
const DHAKA_TZ = 360; // UTC+6

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const timesOf = (date: string, place: PrayerPlace, tz: number) => {
  const slots = prayerTimesFor(date, place, tz);
  expect(slots).not.toBeNull();
  return Object.fromEntries(slots!.map((s) => [s.key, s.time])) as Record<
    string,
    string
  >;
};

describe("prayerTimesFor", () => {
  it("returns the five prayers in the order they are prayed", () => {
    const slots = prayerTimesFor("2026-08-23", DHAKA, DHAKA_TZ)!;
    expect(slots.map((s) => s.key)).toEqual([
      "fajr",
      "dhuhr",
      "asr",
      "maghrib",
      "isha",
    ]);
    expect(slots.map((s) => s.label)).toEqual([
      "Fajr",
      "Dhuhr",
      "Asr",
      "Maghrib",
      "Isha",
    ]);
    const mins = slots.map((s) => at(s.time));
    expect(mins).toEqual([...mins].sort((a, b) => a - b));
  });

  it("every time is a well-formed local clock time", () => {
    for (const date of ["2026-01-01", "2026-05-05", "2026-11-30"]) {
      for (const s of prayerTimesFor(date, DHAKA, DHAKA_TZ)!) {
        expect(s.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      }
    }
  });

  it("puts Maghrib at Dhaka's sunset, summer and winter", () => {
    // Published sunset for Dhaka: 18:47 on 21 June, 17:15 on 21 December.
    expect(
      Math.abs(at(timesOf("2026-06-21", DHAKA, DHAKA_TZ).maghrib) - at("18:47"))
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(at(timesOf("2026-12-21", DHAKA, DHAKA_TZ).maghrib) - at("17:15"))
    ).toBeLessThanOrEqual(3);
  });

  it("is the whole reason the feature exists: the waqts move across the year", () => {
    const june = timesOf("2026-06-21", DHAKA, DHAKA_TZ);
    const december = timesOf("2026-12-21", DHAKA, DHAKA_TZ);
    // A fixed 18:00 reminder is nearly an hour wrong at both ends.
    expect(at(june.maghrib) - at(december.maghrib)).toBeGreaterThan(80);
    expect(at(december.fajr) - at(june.fajr)).toBeGreaterThan(80);
  });

  it("prays Asr later under the Hanafi shadow than the standard one", () => {
    const hanafi = timesOf("2026-08-23", DHAKA, DHAKA_TZ);
    const standard = timesOf("2026-08-23", { ...DHAKA, asr: "standard" }, DHAKA_TZ);
    expect(at(hanafi.asr)).toBeGreaterThan(at(standard.asr));
    // Both still sit between noon and sunset, whichever school is chosen.
    expect(at(standard.asr)).toBeGreaterThan(at(standard.dhuhr));
    expect(at(hanafi.asr)).toBeLessThan(at(hanafi.maghrib));
  });

  it("gives Umm al-Qura its fixed 90 minutes after Maghrib", () => {
    const makkah = timesOf(
      "2026-08-23",
      { lat: 21.4225, lon: 39.8262, method: "makkah", asr: "standard" },
      180
    );
    expect(at(makkah.isha) - at(makkah.maghrib)).toBe(90);
  });

  it("follows the clock it is given, not the longitude alone", () => {
    const london = timesOf(
      "2026-08-23",
      { lat: 51.5072, lon: -0.1276, method: "mwl", asr: "standard" },
      60 // British Summer Time
    );
    // London sunset on 23 August is a few minutes past 20:00.
    expect(Math.abs(at(london.maghrib) - at("20:06"))).toBeLessThanOrEqual(4);
    // An hour of daylight saving moves every time by exactly an hour.
    const winterClock = timesOf(
      "2026-08-23",
      { lat: 51.5072, lon: -0.1276, method: "mwl", asr: "standard" },
      0
    );
    expect(at(london.maghrib) - at(winterClock.maghrib)).toBe(60);
  });

  it("refuses to invent a time where the sun never gets there", () => {
    // Tromsø in midsummer has no true Fajr or Isha — null is the honest
    // answer, and the caller's cue to fall back to the times it was given.
    expect(prayerTimesFor("2026-06-21", { lat: 69.6496, lon: 18.956 }, 120)).toBeNull();
    // The same place in autumn is ordinary again.
    expect(prayerTimesFor("2026-10-15", { lat: 69.6496, lon: 18.956 }, 120)).not.toBeNull();
  });

  it("offers a method for every published angle it names", () => {
    for (const m of CALC_METHODS) {
      const times = prayerTimesFor("2026-08-23", { ...DHAKA, method: m.value }, DHAKA_TZ);
      expect(times).not.toBeNull();
      expect(times!).toHaveLength(5);
    }
    // A wider Fajr angle means an earlier Fajr — the angles are not decorative.
    const karachi = timesOf("2026-08-23", { ...DHAKA, method: "karachi" }, DHAKA_TZ);
    const isna = timesOf("2026-08-23", { ...DHAKA, method: "isna" }, DHAKA_TZ);
    expect(at(karachi.fajr)).toBeLessThan(at(isna.fajr));
  });
});

describe("parsePlace", () => {
  it("takes coordinates and fills in this app's reckoning", () => {
    expect(parsePlace({ lat: 23.8103, lon: 90.4125 })).toEqual({
      lat: 23.8103,
      lon: 90.4125,
      label: null,
      method: "karachi",
      asr: "hanafi",
    });
  });

  it("keeps a label but never lets it into the arithmetic", () => {
    const place = parsePlace({ lat: 21.4225, lon: 39.8262, label: "  Makkah  " });
    expect(place?.label).toBe("Makkah");
  });

  it("rounds off the precision that would only identify a house", () => {
    const place = parsePlace({ lat: 23.81034567, lon: 90.41259876 });
    expect(place?.lat).toBe(23.8103);
    expect(place?.lon).toBe(90.4126);
  });

  it("rejects anything that isn't a point on Earth", () => {
    expect(parsePlace(null)).toBeNull();
    expect(parsePlace({ lat: 91, lon: 0 })).toBeNull();
    expect(parsePlace({ lat: 0, lon: 181 })).toBeNull();
    expect(parsePlace({ lat: "north", lon: 90 })).toBeNull();
    expect(parsePlace({ lon: 90 })).toBeNull();
  });

  it("falls back rather than trusting an unknown method or school", () => {
    const place = parsePlace({ lat: 23.8, lon: 90.4, method: "whatever", asr: "made-up" });
    expect(place?.method).toBe("karachi");
    expect(place?.asr).toBe("hanafi");
  });
});
