"use client";

import { useEffect, useState } from "react";
import { CURRENCIES, formatMoney, type TimeValue } from "@/lib/timeValue";

/**
 * Putting a price on an hour of your life.
 *
 * Typed per **hour**, because that is the unit people actually know about
 * themselves — nobody can tell you what their minute is worth, and everyone
 * can tell you roughly what their hour is. It is stored per minute, since
 * that is what the arithmetic uses, and the two are shown together so the
 * conversion is never a surprise.
 *
 * There is no default and no suggestion. A number the app picked would be
 * the app telling somebody what their time is worth, which is exactly the
 * thing this feature exists for them to decide.
 */
export default function TimeValueSettings() {
  const [value, setValue] = useState<TimeValue | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("$");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/time-value")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { value: TimeValue | null }) => {
        if (!live) return;
        setValue(body.value);
        setCurrency(body.value?.currency ?? "$");
        setAmount(body.value ? String(Math.round(body.value.perMinute * 60 * 100) / 100) : "");
        setLoaded(true);
      })
      .catch(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, []);

  // Computed before the early return — see npm run check:shape.
  const perHour = Number(amount);
  const valid = Number.isFinite(perHour) && perHour > 0;
  const perMinute = valid ? perHour / 60 : 0;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/time-value", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perMinute, currency }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ kind: "bad", text: body?.error ?? "Could not save that" });
        return;
      }
      setValue(body.value);
      setMsg({ kind: "ok", text: "Saved — your hours are priced on the Stats page" });
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setMsg(null);
    try {
      await fetch("/api/time-value", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perMinute: null }),
      });
      setValue(null);
      setAmount("");
      setMsg({ kind: "ok", text: "Cleared — the card is hidden again" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
      <h2 className="font-semibold">⏳ The price of an hour</h2>
      <p className="mt-1 text-sm text-secondary">
        What one hour of your life is worth to you. The Stats page then prices
        every hour you have tracked — the ones you put into something, and the
        ones that went to habits you&apos;d rather drop. It is your number and
        the app never guesses it.
      </p>

      {!loaded ? (
        <div className="skeleton mt-3 h-10 rounded-lg" aria-hidden="true" />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  aria-pressed={currency === c}
                  className={`rounded-md border px-2.5 py-1.5 text-sm font-medium ${
                    currency === c
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-edge text-secondary hover:bg-surface-2"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">Price of an hour</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="0"
                className="w-28 rounded-md border border-edge bg-transparent px-3 py-1.5 text-right tabular-nums outline-none focus:border-accent"
              />
              <span className="text-secondary">an hour</span>
            </label>
            <button
              type="button"
              disabled={busy || !valid}
              onClick={() => void save()}
              className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              Save
            </button>
            {value && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void clear()}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2 disabled:opacity-40"
              >
                Clear
              </button>
            )}
          </div>

          {valid && (
            <p className="mt-2 text-xs text-muted">
              {/* The conversion, out loud: the price is typed by the hour and
                  the arithmetic runs by the minute. */}
              That&apos;s {formatMoney(perMinute, currency)} a minute — a
              45-minute scroll costs {formatMoney(perMinute * 45, currency)}.
            </p>
          )}

          {msg && (
            <p
              className={`animate-fade-in mt-2 text-sm font-medium ${
                msg.kind === "ok"
                  ? "text-green-700 dark:text-green-500"
                  : "text-red-600"
              }`}
            >
              {msg.text}
            </p>
          )}
        </>
      )}
    </section>
  );
}
