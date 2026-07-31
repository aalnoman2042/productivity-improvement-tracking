import { APP_VERSION } from "@/lib/version";

/** Quiet credit line at the bottom of every screen. */
export default function Footer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-muted ${className}`}>
      <span className="text-brand-gradient font-semibold">PIT</span> v
      {APP_VERSION} · Built by{" "}
      <span className="font-semibold text-secondary">Rohan</span>
    </p>
  );
}
