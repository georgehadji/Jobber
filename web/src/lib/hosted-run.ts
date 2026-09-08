import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { jobberRoot } from "@/lib/jobber";
import { slugifyUrl, reportUrl } from "./hosted-run-pure";

export { slugifyUrl, reportUrl };

/**
 * Hosted tier helpers for web/src/app/api/run/route.ts's evaluate/pdf
 * branches — split out from the route (rather than left inline) so they can
 * be unit-tested directly, the same way submit-guard.ts is (web/test-submit-guard.mjs)
 * instead of only through a full route-handler integration test.
 *
 * kind "evaluate"/"pdf" bypass the agent entirely and call the SAME scripts
 * the CLI path uses (openai-eval.mjs, openai-tailor.mjs + generate-pdf.mjs) —
 * an evaluation through the web is byte-identical to the CLI's because it IS
 * the CLI's script (docs/HOSTED-APP-PLAN.md §2.3). Reused via the same
 * CLI-shim convention as batch-runner.sh: web/ spawns root scripts, it does
 * not import them ("the web ORCHESTRATES the real engine, it does NOT
 * reimplement it" — route.ts's own header comment).
 */

/** The workload's fallback chain, read from the SSOT via its CLI shim. */
export function hostedRouteChain(workload: string): string {
  try {
    return execFileSync(process.execPath, [path.join(jobberRoot(), "lib", "llm-providers.mjs"), "--hosted-route", workload], {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
  } catch {
    return "";
  }
}

/** The hosted deployment's own OpenRouter key — distinct from a local-first
 *  user's personal OPENROUTER_API_KEY (openrouter-runner.mjs), which must
 *  never be billed for hosted-tier traffic. Falls back to OPENROUTER_API_KEY
 *  only so a single-key dev/staging setup still works. */
export function hostedApiKey(): string {
  return process.env.WORKLER_OPENROUTER_KEY || process.env.OPENROUTER_API_KEY || "";
}

/** Env for a hosted openai-eval.mjs / openai-tailor.mjs child: the OpenRouter
 *  gateway, the workload's chain, and the zero-retention routing filter. */
export function hostedEnv(workload: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OPENAI_API_KEY: hostedApiKey(),
    OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
    OPENAI_MODEL: hostedRouteChain(workload),
    OPENROUTER_DATA_COLLECTION: "deny",
  };
}

/** Fetch a posting URL's text via the shared capability module (its own CLI
 *  shim — same reuse-not-restate reasoning as hostedRouteChain above), cached
 *  to `.workler/jd-cache/` so the evaluate and pdf hosted branches for the
 *  SAME posting never re-fetch it. Throws on a bad/unfetchable URL — the
 *  caller surfaces that as a 400 before any child process is spawned. */
export function fetchJdCached(url: string): string {
  const cacheDir = path.join(jobberRoot(), ".workler", "jd-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const slug = slugifyUrl(url);
  const cachePath = path.join(cacheDir, `${slug}.txt`);
  if (fs.existsSync(cachePath)) return cachePath;
  const text = execFileSync(
    process.execPath,
    [path.join(jobberRoot(), "lib", "hosted-capabilities.mjs"), "--fetch", url],
    { encoding: "utf-8", timeout: 30_000 },
  );
  fs.writeFileSync(cachePath, text, "utf-8");
  return cachePath;
}
