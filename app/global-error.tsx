"use client";

/**
 * The last resort: an error in the root layout itself.
 *
 * This replaces the whole document when it renders, which has two
 * consequences worth knowing before touching it. It must supply its own
 * `<html>` and `<body>` — and, more surprisingly, **`globals.css` never
 * reaches it**, so there are no theme tokens, no Tailwind classes and no
 * `data-theme` attribute to read. Everything here is inline, and dark mode
 * is followed via the OS setting rather than the reader's choice in the app,
 * because the choice lives in localStorage that this page has no styles to
 * apply anyway.
 *
 * Deliberately tiny. A fallback that needs anything to work is not one.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          // No app theme is available here, so the OS decides.
          background: "Canvas",
          color: "CanvasText",
          colorScheme: "light dark",
        }}
      >
        <main style={{ maxWidth: "26rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>
            PIT couldn&apos;t start
          </h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.75, lineHeight: 1.6 }}>
            Something failed before the app could draw anything. Nothing you
            logged is affected — your days live in the database and in this
            device&apos;s own queue, neither of which this page can touch.
          </p>
          <button
            onClick={() => unstable_retry()}
            style={{
              marginTop: "0.5rem",
              padding: "0.6rem 1.1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "#fff",
              background: "#1c5cab",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ fontSize: "0.75rem", opacity: 0.55 }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
