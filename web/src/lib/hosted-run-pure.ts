/**
 * web/src/lib/hosted-run-pure.ts — the parts of hosted-run.ts that touch
 * neither the filesystem nor a subprocess, split out on purpose so they can
 * be unit-tested with `node --test` directly (test-hosted-run.mjs) instead
 * of only through hosted-run.ts, which imports jobberRoot() and therefore
 * pulls in the rest of web/'s "@/lib/*" alias graph — resolvable by Next's
 * bundler, not by plain Node module resolution, so a module with that import
 * can't be loaded standalone the way this file can.
 */

/** A stable, filesystem-safe cache key for a posting URL. */
export function slugifyUrl(url: string): string {
  return (
    url
      .replace(/^https?:\/\//i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase()
      .slice(0, 80)
      .replace(/^-+|-+$/g, "") || "posting"
  );
}

/** The posting URL a report's header carries (AGENTS.md rule 3: every report
 *  has a `**URL:**` line) — the pdf hosted branch has no URL input (its
 *  `input` is the application number), so it recovers the JD from the report
 *  that was written for it. */
export function reportUrl(reportText: string): string | null {
  const m = reportText.match(/^\*\*URL:\*\*\s*(\S+)/m);
  return m ? m[1] : null;
}
