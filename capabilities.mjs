#!/usr/bin/env node

/**
 * capabilities.mjs — the --capabilities contract for mode-referenced scripts.
 *
 * Modes hardcode `node <script>.mjs <flags>` invocations; validate-mode-
 * invocations.mjs cross-checks them. Scripts used to expose their flags only
 * via --help (slow to probe — some import playwright eagerly, ~15s). The
 * --capabilities flag is the machine-readable fast path: each script prints
 * its supported flags as JSON and exits 0, with no side effects and no slow
 * imports.
 *
 * Contract (schema v1):
 *   { "script": "merge-tracker.mjs", "version": 1, "flags": ["--dry-run", ...], "description": "..." }
 *
 * Usage from a script (before any side-effect imports):
 *   if (handleCapabilities('set-status.mjs', ['--note', '--role', ...], 'Update tracker status')) process.exit(0);
 */

/**
 * Handle the --capabilities flag: print the script's contract as JSON and
 * signal that the caller should exit.
 *
 * @param {string} script - This script's filename (e.g. "merge-tracker.mjs").
 * @param {string[]} flags - Supported flags, including --help.
 * @param {string} [description] - One-line description of what the script does.
 * @returns {boolean} True when --capabilities was requested (caller must exit).
 */
export function handleCapabilities(script, flags, description = '') {
  if (!process.argv.includes('--capabilities')) return false;
  const allFlags = flags.includes('--help') ? flags : [...flags, '--help'];
  console.log(JSON.stringify({ script, version: 1, flags: allFlags.sort(), description }));
  return true;
}
