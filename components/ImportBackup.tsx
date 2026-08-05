"use client";

import { useRef, useState } from "react";
import { cacheClearAll } from "@/lib/sync";

/**
 * Load a JSON export back in — disaster recovery, or moving accounts.
 *
 * Two steps on purpose: the file is read and summarised first, and nothing
 * is sent until the summary has been looked at. Importing is a merge (the
 * server matches trackers by name and overwrites days the file has), so the
 * summary says exactly that before the button does it.
 */

type Parsed = {
  trackers: number;
  entries: number;
  exportedAt: string | null;
  body: unknown;
};

type Result = {
  trackers: { created: number; matched: number };
  entries: { imported: number; skipped: number };
};

export default function ImportBackup() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const [error, setError] = useState("");

  async function choose(file: File | undefined) {
    setError("");
    setDone(null);
    setParsed(null);
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data?.trackers) || !Array.isArray(data?.entries)) {
        throw new Error("not a backup");
      }
      setParsed({
        trackers: data.trackers.length,
        entries: data.entries.length,
        exportedAt:
          typeof data.exportedAt === "string"
            ? data.exportedAt.slice(0, 10)
            : null,
        body: data,
      });
    } catch {
      setError(
        "That file isn't a PIT backup — export one with Download JSON above."
      );
    }
  }

  async function run() {
    if (!parsed || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not import");
      setDone(data as Result);
      setParsed(null);
      if (fileRef.current) fileRef.current.value = "";
      // Every page's cached copy now predates the restore.
      cacheClearAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-edge pt-4">
      <h3 className="text-sm font-semibold">Import a backup</h3>
      <p className="mt-1 text-sm text-secondary">
        Load a <strong>Download JSON</strong> file back in. Trackers are
        matched by name; days in the file overwrite the same days here.
        Nothing not in the file is touched.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={(e) => void choose(e.target.files?.[0])}
        className="mt-3 block w-full text-sm text-secondary file:mr-3 file:rounded-md file:border file:border-edge file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-secondary hover:file:bg-surface-2"
      />

      {parsed && (
        <div className="animate-rise-in mt-3 rounded-md border border-amber-600/40 bg-surface-2 p-3 text-sm">
          <p>
            <strong>{parsed.trackers}</strong> trackers and{" "}
            <strong>{parsed.entries}</strong> entries
            {parsed.exportedAt && <>, exported {parsed.exportedAt}</>}. Days in
            this file will overwrite the same days in your account.
          </p>
          <button
            onClick={run}
            disabled={busy}
            className="mt-3 rounded-md bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Importing…" : "Import it"}
          </button>
        </div>
      )}

      {done && (
        <p className="animate-fade-in mt-3 text-sm font-medium text-green-700 dark:text-green-500">
          ✓ Imported — {done.entries.imported} entries in (
          {done.trackers.created} trackers created, {done.trackers.matched}{" "}
          matched
          {done.entries.skipped > 0 && <>, {done.entries.skipped} rows skipped</>}
          ).
        </p>
      )}

      {error && (
        <p className="animate-fade-in mt-3 text-sm font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
