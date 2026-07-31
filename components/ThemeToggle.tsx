"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

const KEY = "pit_theme";
const ORDER: Theme[] = ["system", "light", "dark"];
const ICON: Record<Theme, string> = { system: "🖥️", light: "☀️", dark: "🌙" };
const LABEL: Record<Theme, string> = {
  system: "Match device",
  light: "Light",
  dark: "Dark",
};

/** Applies the choice and keeps the address-bar colour in step. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#0d0d0d" : "#1c5cab");
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem(KEY) as Theme | null;
    if (stored && ORDER.includes(stored)) setTheme(stored);
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    localStorage.setItem(KEY, next);
    applyTheme(next);
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
