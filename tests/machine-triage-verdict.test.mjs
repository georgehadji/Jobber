// tests/machine-triage-verdict.test.mjs — STATE-MACHINES-PLAN Phase 4.5 (M21): the triage-verdict machine.
// PROSE ONLY: the verdict keywords live in modes/triage.md (Step 4 table, Step 5 return line).
//   - templates/machines/triage-verdict.yml loads and validates
//   - every declared verdict appears literally in modes/triage.md (control: a bogus verdict does not)
//   - verdicts are terminal outputs: no transitions, every state terminal, unknown input rejected
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadMachine } from '../lib/state-machine.mjs';

console.log('\ntriage-verdict machine (Phase 4.5, prose only)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const MODE = readFileSync(join(ROOT, 'modes/triage.md'), 'utf-8');

let machine = null;
try {
  machine = loadMachine('triage-verdict');
  eq('loads and validates; id is triage-verdict', machine.id, 'triage-verdict');
} catch (e) {
  fail(`triage-verdict.yml failed to load: ${e.message}`);
}

if (machine) {
  eq('declares exactly the four verdicts in the mode', machine.states.map(s => s.label).sort(), ['FAIL', 'MARGINAL', 'PASS', 'SKIP']);
  // the return line in the mode is the literal contract the caller parses
  eq('the mode carries the return contract TRIAGE: {PASS|MARGINAL|FAIL|SKIP}', MODE.includes('TRIAGE: {PASS|MARGINAL|FAIL|SKIP}'), true);
  for (const s of machine.states) {
    eq(`verdict "${s.label}" appears in modes/triage.md`, MODE.includes(s.label), true);
  }
  eq('control: a bogus verdict is NOT found in modes/triage.md', MODE.includes('ZZ-UNDECLARED-VERDICT'), false);
  eq('control: the bogus verdict is not declared', machine.states.some(s => s.label === 'ZZ-UNDECLARED-VERDICT'), false);

  eq('no transitions: a verdict is one-shot output', machine.transitions, {});
  eq('every verdict is terminal', machine.states.every(s => s.terminal), true);
  eq('exit_terminal and backward moves are forbidden (nothing to correct)', [machine.policy.exit_terminal, machine.policy.backward_between_live], ['forbidden', 'forbidden']);
  eq('unknown_input is reject', machine.policy.unknown_input, 'reject');
  eq('writers are the triage mode', machine.writers, ['triage']);
}
