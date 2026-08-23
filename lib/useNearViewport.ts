"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * "Has this scrolled close enough to matter yet?"
 *
 * The charts have worked this way for a while — a dashboard that draws
 * fifteen SVGs on arrival feels heavy no matter how fast the data was — and
 * the same reasoning applies to *fetching*, not just drawing. The Status page
 * mounts six things that each go and ask the server something the moment the
 * page appears, and three of them are below the fold. On a phone over mobile
 * data those requests are not free: they share the connection with the ones
 * whose answers are needed to paint the top of the screen.
 *
 * So the rule is the same as the charts': nothing that is off-screen and
 * optional gets to compete with what the reader is actually looking at.
 * 500px of margin means it is already loading by the time it is scrolled to,
 * and it never un-loads — once true, always true.
 *
 * Falls open, deliberately: no IntersectionObserver means everything shows at
 * once, which is the old behaviour rather than a blank page.
 */
export function useNearViewport<T extends HTMLElement>(
  rootMargin = "500px 0px"
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, rootMargin]);

  return [ref, near];
}
