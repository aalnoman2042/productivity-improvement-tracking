"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LINKS } from "@/components/Nav";

/**
 * Swipe left and right between the bottom-nav tabs on a phone — the gesture
 * every tabbed phone app teaches, wired to the same four destinations in the
 * same order as the bar itself.
 *
 * Deliberately conservative about what counts as a page swipe, because a
 * wrong guess *navigates* — which is much worse than a missed gesture:
 *  - only on the tab pages themselves, never inside a detail page or dialog
 *  - not from the screen edges (those belong to the browser's back gesture)
 *  - not starting on inputs, on anything inside [data-no-swipe], or on
 *    content that scrolls sideways itself
 *  - fast and decisively horizontal, or it's ignored
 */

const ORDER = LINKS.map((l) => l.href);

/** Does anything between the touch and the body scroll horizontally? */
function scrollsSideways(el: Element | null): boolean {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (
      (s.overflowX === "auto" || s.overflowX === "scroll") &&
      n.scrollWidth > n.clientWidth + 1
    ) {
      return true;
    }
  }
  return false;
}

export default function SwipeNav() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const idx = ORDER.indexOf(pathname);
    if (idx === -1) return; // not on a tab page — nothing to swipe between

    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      tracking = false;
      if (e.touches.length !== 1) return;
      // The bottom bar only exists below the `sm` breakpoint; on a wide
      // screen a horizontal drag is selection, not navigation.
      if (window.innerWidth >= 640) return;
      const t = e.touches[0];
      if (t.clientX < 24 || t.clientX > window.innerWidth - 24) return;
      const target = e.target as Element | null;
      if (target?.closest("input, textarea, select, [data-no-swipe]")) return;
      if (scrollsSideways(target)) return;
      startX = t.clientX;
      startY = t.clientY;
      startAt = Date.now();
      tracking = true;
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Date.now() - startAt > 600) return; // a drag, not a flick
      if (Math.abs(dx) < 70) return; // too short to mean it
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return; // mostly a scroll
      // Content follows the finger: swiping left pulls in the tab to the right.
      const next = ORDER[idx + (dx < 0 ? 1 : -1)];
      if (next) router.push(next);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [pathname, router]);

  return null;
}
