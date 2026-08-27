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
 * A discovered suite that calls process.exit() would terminate the runner
 * mid-run (test-all: forged exit code, later sections silently never run;
 * test-runner: the whole worker process dies). Refused on sight (#1916).
 *
 * @param {string} source - File contents of a discovered test file.
 * @returns {boolean}
 */
export function callsProcessExit(source) {
  return /\bprocess\.exit\s*\(/.test(source);
}
