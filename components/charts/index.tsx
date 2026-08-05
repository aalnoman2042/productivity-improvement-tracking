"use client";

import dynamic from "next/dynamic";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";

/**
 * Recharts is by far the heaviest dependency here, and none of it is needed
 * until the dashboard actually has data to draw. Two layers keep it cheap:
 *
 * - The code loads lazily (`dynamic`), so the log and tracker screens never
 *   download it at all.
 * - Each chart *mounts* lazily too. A dashboard with fifteen trackers is
 *   fifteen SVG charts, most of them below the fold — drawing them all on
 *   arrival is what makes the page feel heavy on a phone. Every chart shows
 *   its placeholder until it comes within ~500px of the viewport, renders
 *   once, and stays.
 *
 * Each placeholder reserves the same height as the real chart so nothing
 * shifts when the code — or the scroll — arrives.
 */

const Placeholder = ({ height }: { height: number }) => (
  <div className="skeleton w-full" style={{ height }} aria-hidden="true" />
);

function lazyChart<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  defaultHeight: number
): ComponentType<P> {
  const Chart = dynamic(load, {
    ssr: false,
    // The near-view placeholder below matches the real height; this one only
    // shows in the moment between scroll-into-view and the chunk arriving.
    loading: () => <Placeholder height={defaultHeight} />,
  });

  // Memoised so a parent re-render with unchanged props skips the chart —
  // an SVG redraw is the priciest thing on the page.
  return memo(function NearViewChart(props: P) {
    // Charts that take a height prop get a placeholder to match.
    const height = (props as { height?: number }).height ?? defaultHeight;
    const ref = useRef<HTMLDivElement>(null);
    const [show, setShow] = useState(false);

    useEffect(() => {
      if (show) return;
      const el = ref.current;
      if (!el || typeof IntersectionObserver === "undefined") {
        setShow(true);
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setShow(true);
            io.disconnect();
          }
        },
        { rootMargin: "500px 0px" }
      );
      io.observe(el);
      return () => io.disconnect();
    }, [show]);

    return (
      <div ref={ref}>
        {show ? <Chart {...props} /> : <Placeholder height={height} />}
      </div>
    );
  });
}

export const DonutChart = lazyChart(() => import("./DonutChart"), 224);
export const TrendChart = lazyChart(() => import("./TrendChart"), 256);
export const SeriesChart = lazyChart(() => import("./SeriesChart"), 180);
export const SleepClockChart = lazyChart(() => import("./SleepClockChart"), 180);
