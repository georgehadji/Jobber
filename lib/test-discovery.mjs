// lib/test-discovery.mjs — shared discovery/safety logic for tests/**/*.test.mjs,
// used by both test-all.mjs (in-process canonical run) and test-runner.mjs
// (per-file attribution / parallel run). Kept identical between the two so
// they can never silently drift on what counts as a discovered test file.

import { readdirSync } from 'fs';
import { join } from 'path';

/** Recursive discovery — deterministic lexicographic order on every OS. */
export function discoverTests(dir) {
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...discoverTests(full));
    else if (entry.name.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

/**
 * A discovered suite that ends the process would terminate the runner mid-run
 * (test-all: forged exit code, later sections silently never run; test-runner:
 * the whole worker process dies). Refused on sight (#1916).
 *
 * Catches `finish()` as well as a literal `process.exit(`: finish() calls
 * process.exit() internally, so a discovered file calling it truncated the
 * run just as silently — and did, undetected, because the original guard
 * only matched the literal call. tests/eval-runner.test.mjs sorted 8th of
 * 112 discovered files and ended the suite there; everything after it never
 * ran, while test-all still printed a green summary and exited 0.
 *
 * @param {string} source - File contents of a discovered test file.
 * @returns {boolean}
 */
export function endsProcess(source) {
  return /\bprocess\.exit\s*\(/.test(source) || /(?<!\.)\bfinish\s*\(\s*\)/.test(source);
}
