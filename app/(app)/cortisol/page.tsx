import { redirect } from "next/navigation";

/**
 * The cortisol page moved to `/health`.
 *
 * It grew: a curve modelled from sleep, food and movement was never really a
 * page about one hormone, and once it was also reading sitting hours, water
 * against body weight and 150 minutes of movement a week, the URL was the
 * last thing still calling it cortisol. The estimate is still there, as one
 * section of a bigger page.
 *
 * This stays because links outlive names — a bookmark, the Account doorway
 * as it was, a link somebody sent themselves. A permanent redirect is
 * cheaper than a 404 and considerably cheaper than explaining.
 */
export default function CortisolPage() {
  redirect("/health");
}
