// lib/script-outcome.mjs — how test-all.mjs's "2. Script execution" section
// scores one spawned script's exit status.
//
// Extracted so the decision is unit-testable (defect-hunt batch 13, B13-D2).
// The `scripts` array declares `expectExit` on 46 entries, but the loop only
// ever compared `r.status === 0` and never destructured the field, so every
// declaration was dead configuration: an entry could state an expected exit
// code and be scored by an unrelated rule. The one entry declaring a non-zero
// expectation was scored by the exact inverse of what it asked for.

/**
 * Score a spawned script's exit status against its declared expectation.
 *
 * @param {number|null} status - spawnSync status; null when the child was
 *   killed or timed out, which never equals a declared expectation and so
 *   correctly falls through to warn/fail.
 * @param {{expectExit?: number, allowFail?: boolean}} [spec]
 * @returns {'pass'|'warn'|'fail'}
 */
export function scriptOutcome(status, { expectExit = 0, allowFail = false } = {}) {
  if (status === expectExit) return 'pass';
  return allowFail ? 'warn' : 'fail';
}
