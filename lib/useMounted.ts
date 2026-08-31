"use client";

import { useSyncExternalStore } from "react";

/**
 * False on the server and in the very first client render; true after that.
 *
 * For the handful of things that cannot be rendered until there is a browser
 * to render them in — anything derived from the reader's *clock*, above all.
 * `/dashboard` and `/status` are statically prerendered, so a `new Date()`
 * read during render is the date of the **build**: it gets written into the
 * HTML on the CDN and stays there until the next deploy. Everything fetched
 * is safe (it is null on the server either way); it is the period picker's
 * own labels — "31 Aug - 6 Sep 2026" — that would be a week old by Tuesday
 * and a hydration mismatch on every visit.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: it has a
 * separate server snapshot by design, needs no effect, and so trips neither
 * the set-state-in-effect rule nor the component-shape check.
 */
const noop = () => () => {};

export function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false
  );
}
