// tests/harness-script-outcome.test.mjs — the two defect-hunt batch 13 findings
// in test-all.mjs's own inline assertions.
//
// B13-D2: the "2. Script execution" loop declared `expectExit` on 46 entries and
// never read it, comparing every script against a hardcoded 0. Declarations that
// look like a spec and bind nothing are worse than no spec: the one entry that
// declared a non-zero expectation was scored by the exact inverse of what it
// asked for, so a script violating its stated contract scored a pass.
//
// B13-D1: the type-check section skipped with a bare console.log when typescript
// was absent, leaving the summary reading "0 warnings" and "safe to push/merge"
// with an entire check silently not run. Its sibling — the dashboard build, when
// the go compiler is absent — uses warn(), which does not fail the run either
// (exit 0, amber verdict) but keeps the skip visible in the counters.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { scriptOutcome } from '../lib/script-outcome.mjs';

console.log('\ntest-all.mjs harness — script outcome scoring and skip visibility (B13)');

// ── B13-D2: expectExit is honored ────────────────────────────────
const cases = [
  ['default expectation, clean exit', 0, {}, 'pass'],
  ['default expectation, non-zero exit', 1, {}, 'fail'],
  ['default expectation, non-zero exit, allowFail', 1, { allowFail: true }, 'warn'],
  ['declared non-zero expectation met', 1, { expectExit: 1 }, 'pass'],
  // The defect itself: before the fix this scored 'pass', because the loop
  // compared against 0 and ignored the declaration entirely.
  ['declared non-zero expectation VIOLATED by a clean exit', 0, { expectExit: 1 }, 'fail'],
  ['declared non-zero expectation violated, allowFail softens to warn', 0, { expectExit: 1, allowFail: true }, 'warn'],
  // spawnSync reports null when it kills the child (timeout/signal). That must
  // never satisfy a declared expectation, including expectExit: 0.
  ['killed child (null status) never counts as meeting expectExit 0', null, {}, 'fail'],
  ['killed child (null status) never counts as meeting a non-zero expectExit', null, { expectExit: 1 }, 'fail'],
];

for (const [label, status, spec, want] of cases) {
  const got = scriptOutcome(status, spec);
  if (got === want) pass(`scriptOutcome: ${label} → ${want}`);
  else fail(`scriptOutcome: ${label} → expected ${want}, got ${got}`);
}

// The loop must actually consult the helper — extracting it is pointless if the
// call site still hardcodes a comparison.
const testAll = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8');
if (/for \(const \{[^}]*\bexpectExit\b[^}]*\} of scripts\)/.test(testAll)) {
  pass('the script-execution loop destructures expectExit from each entry');
} else {
  fail('the script-execution loop no longer reads expectExit — declarations are dead config again (B13-D2)');
}
if (/scriptOutcome\(\s*r\.status/.test(testAll)) {
  pass('the script-execution loop scores exit status through scriptOutcome()');
} else {
  fail('the script-execution loop no longer calls scriptOutcome() — the scoring rule is untested again');
}

// ── B13-D1: an absent optional toolchain is visible in the summary ─
// Both optional-toolchain skips must report through warn(), so the summary's
// counters reflect that a check did not run. A bare console.log is invisible
// there and leaves the run reporting a clean green.
const skipBranches = [
  ['typescript absent (type checks)', /typescript not installed/],
  ['go compiler absent (dashboard build)', /go compiler not in env/],
];
for (const [label, rx] of skipBranches) {
  const line = testAll.split(/\r?\n/).find((l) => rx.test(l) && !/^\s*(\/\/|\*)/.test(l));
  if (!line) {
    fail(`${label}: skip branch not found — this guard needs updating alongside the rename`);
  } else if (/\bwarn\(/.test(line)) {
    pass(`${label}: skip is reported through warn(), so it shows in the summary`);
  } else {
    fail(`${label}: skip uses ${/console\.log/.test(line) ? 'console.log' : 'neither warn() nor console.log'} — the summary will read green with the check silently not run (B13-D1)`);
  }
}
