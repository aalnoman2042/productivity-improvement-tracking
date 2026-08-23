"use client";

import { Component, type ReactNode } from "react";

/**
 * A fence around one card, so that card can fail alone.
 *
 * `app/error.tsx` catches anything that throws below it, which means anything
 * that throws takes the **whole screen** — on the admin page, one card that
 * could not read a database size replaced the user counts, the accounts
 * table and everything else with an apology. That is the wrong trade for a
 * panel that is nice to have.
 *
 * So the rule this encodes: a card that is *supplementary* to its page gets
 * one of these. Then the worst it can do is replace itself with a sentence,
 * and the page it sits on never learns anything happened. The route-level
 * boundary stays for what actually is fatal.
 *
 * A class component because that is still the only way to catch a render
 * error in React — hooks cannot do it. The React Compiler leaves classes
 * alone, which as it happens makes this immune to the very bug that prompted
 * it (`npm run check:shape`).
 */
export default class CardBoundary extends Component<
  {
    /** Shown on the fallback so the reader knows what is missing. */
    title: string;
    /** What to say instead. Kept short: this is a card, not an incident. */
    message?: string;
    children: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // The console is where the owner looks; this app reports to nothing by
    // design, so a swallowed error with no trace would be worse than the
    // crash it replaced.
    console.error(`Card "${this.props.title}" failed:`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <section className="rounded-xl border border-edge card p-4 shadow-sm">
        <h2 className="font-semibold">{this.props.title}</h2>
        <p className="mt-1 text-sm text-secondary">
          {this.props.message ??
            "This part couldn't load. Everything else on this page is unaffected."}
        </p>
      </section>
    );
  }
}
