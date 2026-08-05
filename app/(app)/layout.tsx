import Nav from "@/components/Nav";
import SwipeNav from "@/components/SwipeNav";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Nav />
      {/* Swipe left/right anywhere on a tab page moves between the bottom
          tabs — renders nothing, just listens. */}
      <SwipeNav />
      {/* The credit line lives on the Account page only — every other screen
          is for your data, not for the byline. */}
      <main className="app-main mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-4 sm:py-6">
        {children}
      </main>
    </>
  );
}
