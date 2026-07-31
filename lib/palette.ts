/**
 * Validated categorical palette (dataviz reference instance).
 * Activities store the light hex as their canonical color; charts render
 * via the matching CSS variable so dark mode swaps to the dark step.
 */
export const SERIES_PALETTE = [
  { name: "Blue", light: "#2a78d6", dark: "#3987e5" },
  { name: "Orange", light: "#eb6834", dark: "#d95926" },
  { name: "Aqua", light: "#1baf7a", dark: "#199e70" },
  { name: "Yellow", light: "#eda100", dark: "#c98500" },
  { name: "Magenta", light: "#e87ba4", dark: "#d55181" },
  { name: "Green", light: "#008300", dark: "#008300" },
  { name: "Violet", light: "#4a3aa7", dark: "#9085e9" },
  { name: "Red", light: "#e34948", dark: "#e66767" },
] as const;

/** Resolve a stored activity color to a theme-aware CSS variable. */
export function seriesColor(storedHex: string): string {
  const i = SERIES_PALETTE.findIndex(
    (p) => p.light.toLowerCase() === storedHex.toLowerCase()
  );
  return i >= 0 ? `var(--series-${i + 1})` : storedHex;
}
