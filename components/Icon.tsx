import { ICONS, type IconName } from "@/lib/icons";

/**
 * One icon, drawn by this app rather than by the reader's operating system.
 *
 * Inline SVG on purpose — not an icon font, not a sprite file, not an `<img>`.
 * It inherits `currentColor`, so a tab turns accent-blue when it is active
 * and grey when it is not without a second copy of the artwork; it needs no
 * request, so it is never the thing that arrives late on a cold open; and it
 * costs no runtime, which matters because these render on every screen.
 *
 * Not a client component: it has no state and no handlers, so it renders on
 * the server and ships no JavaScript of its own.
 *
 * `title` is what makes it accessible. Without one the icon is decoration and
 * is hidden from screen readers, which is correct wherever a visible label
 * sits beside it — the bottom nav, for instance, where reading "Stats stats"
 * would be worse than reading nothing.
 */
export default function Icon({
  name,
  size = 20,
  title,
  className,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  /** Only when the icon stands alone; a labelled icon must stay decoration. */
  title?: string;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      // Icons sit on text baselines all over this app; without this they
      // push their line taller than the words beside them.
      style={{ display: "block", flexShrink: 0 }}
    >
      {ICONS[name].map((p, i) =>
        p.fill ? (
          <path key={i} d={p.d} fill="currentColor" stroke="none" />
        ) : (
          <path key={i} d={p.d} />
        )
      )}
    </svg>
  );
}
