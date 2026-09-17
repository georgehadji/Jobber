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

/**
 * Score a synchronous build/compile attempt by WHY it failed, not just that it did.
 *
 * execFileSync throws for two situations that deserve opposite verdicts: the
 * toolchain rejected the source (a real failure), and the toolchain was still
 * working when the timeout fired (an environment problem). Collapsing them —
 * which `run()` does, by returning null for both — turns machine load into a
 * red suite on a healthy tree. That is the repo's own assertion rule 3:
 * capture the reason, not just the rejection.
 *
 * A timed-out child is reported as 'timeout' so the caller can warn() rather
 * than fail(): a build that could not be attempted is not a failing build,
 * the same way a fixture that could not be built is not a passing test.
 *
 * @param {unknown} err - The thrown error, or null/undefined when the build succeeded.
 * @returns {'pass'|'timeout'|'fail'}
 */
export function buildOutcome(err) {
  if (!err) return 'pass';
  // execFileSync signals a timeout kill as ETIMEDOUT and/or a non-null signal
  // (SIGTERM on POSIX). Either one means the clock ran out, not the compiler.
  if (err.code === 'ETIMEDOUT' || err.signal) return 'timeout';
  return 'fail';
}
