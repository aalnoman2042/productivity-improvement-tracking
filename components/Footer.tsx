/** Quiet credit line at the bottom of every screen. */
export default function Footer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-muted ${className}`}>
      Built by{" "}
      <a
        href="https://abdullah-al-noman.vercel.app/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-secondary underline-offset-2 hover:underline"
      >
        Rohan
      </a>
    </p>
  );
}
