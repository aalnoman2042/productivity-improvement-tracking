import Link from "next/link";
import Logo from "@/components/Logo";

/**
 * A page that isn't there.
 *
 * Reachable in practice by a signed-in reader following an address the app
 * used to have — `/books` and `/today` are redirected in `proxy.ts`, but a
 * bookmark to something deeper than that lands here. Signed-out visitors
 * never see it: the proxy sends them to the pitch or to login first.
 *
 * So the job is not to apologise, it is to get someone back to the thing
 * they open every day in one tap.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <div className="rounded-xl border border-edge card p-6 text-center shadow-sm">
        <div className="flex justify-center">
          <Logo size={40} />
        </div>
        <h1 className="text-brand-gradient mt-4 text-2xl font-bold tracking-tight">
          That page isn&apos;t here
        </h1>
        <p className="mt-2 text-sm text-secondary">
          The address doesn&apos;t match anything in PIT. It may have been a
          page that moved — the log, the shelf and the pitch have all changed
          addresses at some point.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <Link
            href="/"
            className="rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-medium text-white hover:brightness-110"
          >
            Go to today&apos;s log
          </Link>
          <div className="flex gap-2">
            <Link
              href="/status"
              className="flex-1 rounded-lg border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2"
            >
              Status
            </Link>
            <Link
              href="/trackers"
              className="flex-1 rounded-lg border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2"
            >
              Trackers
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
