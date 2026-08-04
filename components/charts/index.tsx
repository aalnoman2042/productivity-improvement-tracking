"use client";

import dynamic from "next/dynamic";

/**
 * Recharts is by far the heaviest dependency here, and none of it is needed
 * until the dashboard actually has data to draw. Loading these lazily keeps
 * it out of the first download for the log and tracker screens.
 *
 * Each placeholder reserves the same height as the real chart so nothing
 * shifts when the code arrives.
 */

const Placeholder = ({ height }: { height: number }) => (
  <div className="skeleton w-full" style={{ height }} aria-hidden="true" />
);

export const DonutChart = dynamic(() => import("./DonutChart"), {
  ssr: false,
  loading: () => <Placeholder height={224} />,
});

export const TrendChart = dynamic(() => import("./TrendChart"), {
  ssr: false,
  loading: () => <Placeholder height={256} />,
});

export const SeriesChart = dynamic(() => import("./SeriesChart"), {
  ssr: false,
  loading: () => <Placeholder height={180} />,
});

export const SleepClockChart = dynamic(() => import("./SleepClockChart"), {
  ssr: false,
  loading: () => <Placeholder height={180} />,
});
