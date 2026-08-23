"use client";

import { useState } from "react";
import { toDateStr } from "@/lib/dates";
import {
  ASR_SCHOOLS,
  CALC_METHODS,
  PLACE_PRESETS,
  prayerTimesFor,
  type PrayerPlace,
} from "@/lib/prayerTimes";

/**
 * Where to put the sun, for a namaz tracker whose reminders follow the waqts.
 *
 * The whole point of this control is that it shows its work: pick a place and
 * today's five times appear underneath, computed in the browser by the same
 * function the reminder schedule uses on the server. If those times look
 * wrong to the person reading them, they can see it here rather than
 * discovering it at Maghrib.
 *
 * Coordinates are rounded to about a neighbourhood before they are stored
 * (`parsePlace`), and they never leave this account.
 */

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export default function PrayerTimesPicker({
  place,
  onChange,
}: {
  place: PrayerPlace | null;
  onChange: (place: PrayerPlace) => void;
}) {
  // Read once, in an initializer: the React Compiler is right that a clock
  // in render is impure, and a picker doesn't need to tick.
  const [today] = useState(() => toDateStr(new Date()));
  const [tzOffset] = useState(() => -new Date().getTimezoneOffset());
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  const slots = place ? prayerTimesFor(today, place, tzOffset) : null;

  function set(patch: Partial<PrayerPlace>) {
    const base: PrayerPlace = place ?? {
      lat: PLACE_PRESETS[0].lat,
      lon: PLACE_PRESETS[0].lon,
      label: PLACE_PRESETS[0].label,
      method: "karachi",
      asr: "hanafi",
    };
    onChange({ ...base, ...patch });
  }

  function locate() {
    setError("");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser won't share a location — pick a city instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        set({
          lat: round4(pos.coords.latitude),
          lon: round4(pos.coords.longitude),
          label: null,
        });
      },
      () => {
        setLocating(false);
        setError("Couldn't get your location — pick a city instead.");
      },
      { timeout: 10_000, maximumAge: 600_000 }
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-edge bg-surface-2 p-3">
      <div>
        <p className="text-sm font-medium">Where you pray</p>
        <p className="mt-0.5 text-xs text-muted">
          The waqts are worked out from the sun, so they move with the year —
          which is the point. Nothing is sent anywhere; the times are computed
          on your own device and on your own server.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className="rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-secondary hover:bg-surface-2 disabled:opacity-40"
        >
          {locating ? "Locating…" : "📍 Use my location"}
        </button>
        {PLACE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => set({ lat: p.lat, lon: p.lon, label: p.label })}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              place?.label === p.label
                ? "border-accent bg-accent/10 text-accent"
                : "border-edge text-secondary hover:bg-surface-2"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {place && (
        <p className="text-xs text-muted">
          {place.label
            ? `${place.label} — ${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}`
            : `${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}`}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-secondary">Calculation</span>
          <select
            value={place?.method ?? "karachi"}
            onChange={(e) => set({ method: e.target.value as PrayerPlace["method"] })}
            className="mt-1 w-full rounded-md border border-edge card px-2 py-1.5 text-sm"
          >
            {CALC_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-secondary">Asr</span>
          <select
            value={place?.asr ?? "hanafi"}
            onChange={(e) => set({ asr: e.target.value as PrayerPlace["asr"] })}
            className="mt-1 w-full rounded-md border border-edge card px-2 py-1.5 text-sm"
          >
            {ASR_SCHOOLS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* The proof. If these five are wrong, everything downstream is. */}
      {slots ? (
        <div>
          <p className="text-xs text-secondary">Today, where you are:</p>
          <div className="mt-1.5 grid grid-cols-5 gap-1 text-center">
            {slots.map((s) => (
              <div key={s.key} className="rounded-md border border-edge card p-1.5">
                <div className="text-[11px] text-muted">{s.label}</div>
                <div className="text-sm font-semibold tabular-nums">{s.time}</div>
              </div>
            ))}
          </div>
        </div>
      ) : place ? (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          At this latitude the sun doesn&apos;t reach the twilight angles
          today, so there are no true waqts to compute. The times you typed
          stay in use.
        </p>
      ) : null}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
