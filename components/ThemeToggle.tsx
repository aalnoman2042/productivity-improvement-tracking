"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const KEY = "pit_theme";
const THEME_EVENT = "pit-theme-change";
const ICON: Record<Theme, string> = { light: "☀️", dark: "🌙" };
const LABEL: Record<Theme, string> = { light: "Light", dark: "Dark" };

/**
 * Light for everyone until they choose otherwise — a phone set to dark mode
 * doesn't decide what the app looks like. The choice is stored per device
 * and applied before first paint by the script in `app/layout.tsx`.
 */

/** Applies the choice and keeps the address-bar colour in step. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#232323" : "#1c5cab");
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readTheme(): Theme {
  try {
    // "system" is what the old three-way toggle stored — it now means light.
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

const serverTheme = (): Theme => "light";

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);

  function cycle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode — the theme still applies for this page view */
    }
    applyTheme(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <button
      onClick={cycle}
      className="rounded-md border border-edge px-2.5 py-1.5 text-sm hover:bg-surface-2"
      title={`Theme: ${LABEL[theme]} — tap to change`}
      aria-label={`Theme: ${LABEL[theme]}. Tap to change.`}
    >
      {ICON[theme]}
    </button>
  );
}
