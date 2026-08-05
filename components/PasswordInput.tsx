"use client";

import { useState } from "react";

/**
 * A password field with an eye — tap to see what you actually typed.
 *
 * On a phone keyboard, most wrong passwords are typos, and the dots make a
 * typo invisible until the server rejects it. Visibility is per-field state,
 * never remembered anywhere.
 */

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {open && <path d="m4 4 16 16" />}
    </svg>
  );
}

export default function PasswordInput({
  value,
  onChange,
  autoComplete,
  autoFocus = false,
  required = true,
  minLength,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  required?: boolean;
  minLength?: number;
  /** Extra classes for the wrapper — margins, not field styling. */
  className?: string;
}) {
  const [shown, setShown] = useState(false);

  return (
    <div className={`relative ${className}`}>
      <input
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-edge bg-transparent py-2 pr-11 pl-3 outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password" : "Show password"}
        title={shown ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-foreground"
      >
        <EyeIcon open={shown} />
      </button>
    </div>
  );
}
