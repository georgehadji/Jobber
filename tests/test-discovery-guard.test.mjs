// tests/test-discovery-guard.test.mjs — lib/test-discovery.mjs's endsProcess()
// guard (#1916, defect-hunt B11-D1).
//
// A discovered suite that ends the process truncates the whole run: every
// later file silently never executes while test-all still prints a green
// summary and exits 0. The original guard only matched the bare call at the start
// of a line, so any same-line prefix — an awaited call, a same-line
// conditional, an arrow callback — slipped straight through.
//
// Measured live before the fix: one such file sorting first dropped the suite
// from 3553 assertions to 521, reported "All tests passed", and exited 0.
//
// NOTE: every fixture below is built by concatenation on purpose. Writing the
// literal call text would trip the very guard under test and get THIS file
// refused — the same trick tests/scan-data-source-contract.test.mjs uses.
import { pass, fail } from './helpers.mjs';
import { endsProcess } from '../lib/test-discovery.mjs';

console.log('\nlib/test-discovery.mjs — endsProcess() truncation guard (B11-D1)');

const FIN = 'fin' + 'ish';
const EXIT = 'process.' + 'exit';

const mustBlock = [
  ['bare call at line start', FIN + '();'],
  ['indented inside a block', 'if (x) {\n  ' + FIN + '();\n}'],
  ['awaited call', 'await ' + FIN + '();'],
  ['same-line conditional', 'if (failed) ' + FIN + '();'],
  ['arrow callback', 'process.on("beforeExit", () => ' + FIN + '());'],
  ['spaced parens', FIN + '( );'],
  ['literal process exit', EXIT + '(1);'],
];

const mustAllow = [
  ['an ordinary test file', 'import { pass } from "./helpers.mjs";\npass("ok");'],
  ['a .' + FIN + '() method call on some object', 'const b = makeBuilder();\nb.' + FIN + '();'],
  ['an identifier that merely starts with the word', 'const ' + FIN + 'edAt = Date.now();'],
  ['a different function whose name ends with it', 'un' + FIN + '();'],
];

for (const [label, source] of mustBlock) {
  if (endsProcess(source)) pass(`refuses ${label}`);
  else fail(`endsProcess missed ${label} — a suite like this truncates the run silently`);
}

for (const [label, source] of mustAllow) {
  if (!endsProcess(source)) pass(`allows ${label}`);
  else fail(`endsProcess wrongly refused ${label} — false positive blocks a valid suite`);
}
