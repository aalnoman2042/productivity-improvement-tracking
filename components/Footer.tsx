/** Quiet credit line at the bottom of every screen. */
export default function Footer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-muted ${className}`}>
      Built by <span className="font-semibold text-secondary">Rohan</span>
    </p>
  );
}
