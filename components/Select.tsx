"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * A dropdown that belongs to this app.
 *
 * A native `<select>` can be styled down to its last pixel *while closed* —
 * and the moment it opens, the operating system draws the list. On Windows
 * that is a flat white rectangle with a blue highlight, in a dark-themed app,
 * next to cards with soft shadows and 1rem corners. `option { background }`
 * does not reach it; nothing in CSS does. So the only honest way to have a
 * dropdown that looks like the rest of the app is to stop using the browser's
 * one for the part the browser insists on owning.
 *
 * This is a button plus a themed listbox, and it carries the whole keyboard
 * contract a `<select>` gives you for free — because that contract is the
 * reason people reach for the native control in the first place, and a
 * prettier dropdown that cannot be driven from a keyboard is a downgrade
 * wearing better clothes:
 *
 * - Enter, Space, ArrowUp/Down open it, with focus landing on the current value
 * - ArrowUp/Down move, Home/End jump, Escape closes and returns focus
 * - Typing a letter jumps to the next option starting with it
 * - Tab or a click anywhere else closes it
 * - `role="listbox"` / `role="option"` + `aria-selected`, so a screen reader
 *   is told what this is rather than hearing a pile of buttons
 *
 * It deliberately does NOT try to be a `<select>` in a form — nothing here
 * submits a form, everything is React state — so there is no hidden input and
 * no name attribute. If that is ever needed, add it here rather than going
 * back to the native element.
 */

export type Option = { value: string; label: string; hint?: string };

export default function Select({
  value,
  options,
  onChange,
  label,
  className = "",
  buttonClassName = "",
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  /** For assistive tech — this control has no visible label of its own. */
  label: string;
  /** On the wrapper, which is what positions the panel. */
  className?: string;
  /** On the button, for width and typography at each call site. */
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();

  const selected = options.findIndex((o) => o.value === value);
  const current = selected >= 0 ? options[selected] : null;

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  const choose = useCallback(
    (index: number) => {
      const opt = options[index];
      if (opt) onChange(opt.value);
      close();
    },
    [options, onChange, close]
  );

  // Close on a click anywhere else, and on scroll of an ancestor — the panel
  // is absolutely positioned, so a page that moves under it would leave it
  // hanging over the wrong control.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("focusin", away);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("focusin", away);
      window.removeEventListener("resize", away);
    };
  }, [open]);

  // Focus follows the active option so the keyboard contract is the real one
  // rather than an aria-activedescendant approximation.
  useEffect(() => {
    if (!open) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openAt = (index: number) => {
    setActive(Math.max(0, index));
    setOpen(true);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openAt(selected);
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
      return;
    }
    // Type-ahead. The buffer resets after a pause, so "se" finds September
    // and a later lone "s" starts again rather than looking for "ses".
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = e.timeStamp;
      const t = typed.current;
      t.text = now - t.at > 900 ? e.key : t.text + e.key;
      t.at = now;
      const hit = options.findIndex((o) =>
        o.label.toLowerCase().startsWith(t.text.toLowerCase())
      );
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <div ref={wrap} className={`relative ${className}`} onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close(false) : openAt(selected))}
        className={`flex w-full items-center justify-between gap-2 rounded-md border border-edge bg-surface px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 ${buttonClassName}`}
      >
        <span className="min-w-0 truncate">{current?.label ?? ""}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        >
          <path
            d="M3.5 6 8 10.5 12.5 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          ref={list}
          role="listbox"
          aria-label={label}
          id={id}
          // Above everything on the page but below the modals, and capped so a
          // long list (a year of months) scrolls instead of running off screen.
          className="animate-fade-in absolute left-0 right-0 z-30 mt-1 max-h-64 min-w-max overflow-y-auto rounded-xl border border-edge card p-1 shadow-lg"
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                data-i={i}
                aria-selected={isSelected}
                tabIndex={-1}
                onClick={() => choose(i)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition-colors ${
                  isSelected
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-foreground hover:bg-surface-2 focus:bg-surface-2"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && (
                  <span className="shrink-0 text-xs text-muted">{o.hint}</span>
                )}
                {isSelected && (
                  <span aria-hidden="true" className="shrink-0 text-xs">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
