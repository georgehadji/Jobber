// tests/counter-parity.test.mjs — every discovered suite must report through
// pass()/fail()/warn() from tests/helpers.mjs, never by printing the result
// markers itself (defect-hunt batch 12, B12-D1).
//
// WHY THIS MATTERS. The three counting paths read results differently:
//
//   test-all.mjs            in-process import, reads the shared counters
//   test-runner (serial)    in-process import, reads the shared counters
//   test-runner --parallel  child process, scrapes the markers from stdout
//
// A file that prints its own marker lines with console.log instead of calling
// pass() is therefore scored 0 by the first two and scored its real assertion
// count by the third. Measured on this repo before the fix: serial totalled
// 3044 and --parallel totalled 3054 over the same 148 files, both reported as
// confidently green, with the entire 10-assertion difference coming from one
// file (application-artifacts.test.mjs). Nothing was hidden — a failure in
// such a file still surfaces on all three paths, verified by deliberately
// breaking one — but the suite's headline number depended on which runner you
// happened to invoke, which is not a property a measuring instrument may have.
//
// NOTE: the fixtures below are built by concatenation so this file does not
// match its own guard, the same technique tests/scan-data-source-contract.mjs
// and tests/test-discovery-guard.test.mjs use.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { discoverTests } from '../lib/test-discovery.mjs';

console.log('\ntest harness — every suite reports through the shared counters (B12-D1)');

// A marker line is two spaces, the emoji, then a space (warn uses two). Only a
// console.log whose literal STARTS that way desyncs the runners — an emoji
// inside an assertion's description does not, and must not be refused:
// sync-pdf-flags legitimately names an assertion "flips X to Y when present in
// manifest" using both emoji, and scoring that as a marker was itself a bug
// (see the countMarker comment in test-runner.mjs).
const LOG = 'console' + '.log';
const OK = '✅';
const NO = '❌';
const WARN = '⚠️';
const selfPrintsMarkers = (src) =>
  new RegExp(`${LOG}\\(\\s*[\`'"]\\s{2}(${OK}|${NO}|${WARN})`).test(src);

const files = discoverTests(join(ROOT, 'tests'));
const offenders = files
  .map((f) => ({ rel: f.slice(ROOT.length + 1).replace(/\\/g, '/'), src: readFileSync(f, 'utf-8') }))
  .filter(({ src }) => selfPrintsMarkers(src))
  .map(({ rel }) => rel);

if (offenders.length === 0) {
  pass(`all ${files.length} discovered suites report through pass()/fail()/warn()`);
} else {
  for (const rel of offenders) {
    fail(`${rel} prints its own result markers — serial mode will score it 0 while --parallel scrapes its real count; use pass()/fail() from tests/helpers.mjs`);
  }
}

// The guard must actually fire on the shape it exists to catch, and must not
// fire on an emoji that merely appears inside an assertion description.
const MUST_FLAG = `${LOG}('  ${OK} something passed');`;
const MUST_ALLOW = `pass('flips ${NO} to ${OK} when present in manifest');`;

if (selfPrintsMarkers(MUST_FLAG)) pass('guard flags a suite printing its own marker line');
else fail('guard missed a self-printed marker line — the parity check is inert');

if (!selfPrintsMarkers(MUST_ALLOW)) pass('guard allows marker emoji inside an assertion description');
else fail('guard wrongly flagged an emoji inside a description — false positive blocks valid suites');
