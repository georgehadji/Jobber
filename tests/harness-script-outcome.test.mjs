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
import { scriptOutcome, buildOutcome } from '../lib/script-outcome.mjs';

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

// ── buildOutcome: a timed-out build is not a failed build ────────
//
// The dashboard section used run(), which returns null both when the compiler
// rejects the source and when the build is still going at the timeout. On a
// loaded machine with a cold Go cache that reported "Dashboard build failed"
// on a tree whose dashboard compiles fine — machine load rendered as a code
// defect. Same shape as run()'s own 30s-default regression documented in
// tests/helpers.mjs.
const buildCases = [
  ['success (no error)', null, 'pass'],
  ['success (undefined error)', undefined, 'pass'],
  // A real rejection: non-zero status, no signal, no timeout code.
  ['compiler rejected the source', { status: 1, stderr: './main.go:7:2: undefined: foo' }, 'fail'],
  ['compiler rejected with status 2', { status: 2, stderr: 'build failed' }, 'fail'],
  // The defect: both of these used to be indistinguishable from the two above.
  ['killed by timeout (ETIMEDOUT)', { code: 'ETIMEDOUT', signal: 'SIGTERM' }, 'timeout'],
  ['killed by signal alone', { signal: 'SIGTERM', status: null }, 'timeout'],
  ['ETIMEDOUT without a signal', { code: 'ETIMEDOUT' }, 'timeout'],
];

for (const [label, err, want] of buildCases) {
  const got = buildOutcome(err);
  if (got === want) pass(`buildOutcome: ${label} → ${want}`);
  else fail(`buildOutcome: ${label} → expected ${want}, got ${got}`);
}

// Control for the timeout cases above: a classifier that answered 'timeout' for
// everything non-null would satisfy all three. A plain non-zero exit must still
// reach 'fail', and success must still reach 'pass'.
if (buildOutcome({ status: 1 }) === 'fail' && buildOutcome(null) === 'pass') {
  pass('buildOutcome: timeout detection did not swallow ordinary failures or successes');
} else {
  fail('buildOutcome: classifier is over-broad — it does not separate timeout from exit status');
}

// The dashboard call site must route a timeout to warn(), not fail(). Asserting
// on source text here rather than behaviour is deliberate: spawning a real Go
// build that exceeds a timeout would take minutes and still be machine-dependent
// — the exact flakiness this fix exists to remove.
{
  // Anchor on the section heading and stop at the next section, so the window
  // is the dashboard block and nothing else. A slice that silently missed would
  // make every check below pass vacuously, so assert the bounds resolved first.
  const start = testAll.indexOf('4. Dashboard build');
  const end = testAll.indexOf('5. Data contract validation');
  if (start !== -1 && end > start) pass('dashboard build section located in test-all.mjs');
  else fail(`dashboard build section not found (start=${start}, end=${end}) — this guard needs updating alongside the rename`);
  const window = testAll.slice(start, end);
  if (/buildOutcome\(/.test(window)) pass('dashboard build consults buildOutcome()');
  else fail('dashboard build does not call buildOutcome() — the call site still collapses the two cases');

  if (/'timeout'[\s\S]{0,200}?\bwarn\(/.test(window)) pass("dashboard build reports a 'timeout' verdict through warn(), not fail()");
  else fail("dashboard build does not route the 'timeout' verdict to warn() — a slow machine will still show a red suite");

  if (!/\brun\('go',/.test(window)) pass('dashboard build no longer uses run() for the compile step');
  else fail('dashboard build still calls run(), which discards why the build stopped');
}
