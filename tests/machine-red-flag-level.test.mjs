// tests/machine-red-flag-level.test.mjs — STATE-MACHINES-PLAN Phase 4.5 (M21): the red-flag-level machine.
// PROSE ONLY: the levels live in modes/interview-redflag.md (Step 4 table).
//   - templates/machines/red-flag-level.yml loads and validates
//   - every level name and alias appears literally in the mode (control: a bogus level does not)
//   - levels are assigned, not walked: no transitions, every level terminal, unknown input rejected
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadMachine } from '../lib/state-machine.mjs';

console.log('\nred-flag-level machine (Phase 4.5, prose only)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const MODE = readFileSync(join(ROOT, 'modes/interview-redflag.md'), 'utf-8');

let machine = null;
try {
  machine = loadMachine('red-flag-level');
  eq('loads and validates; id is red-flag-level', machine.id, 'red-flag-level');
} catch (e) {
  fail(`red-flag-level.yml failed to load: ${e.message}`);
}

if (machine) {
  eq('declares exactly the three levels in the mode table', machine.states.map(s => s.label).sort(), ['Caution', 'None', 'Warning']);
  for (const s of machine.states) {
    eq(`level "${s.label}" appears in modes/interview-redflag.md`, MODE.includes(`| ${s.label} |`), true);
    for (const a of s.aliases) {
      eq(`label text "${a}" (${s.label}) appears in modes/interview-redflag.md`, MODE.includes(a), true);
    }
  }
  eq('control: a bogus level is NOT found in the mode table', MODE.includes('| Catastrophic |'), false);
  eq('control: a bogus label text is NOT found in the mode', MODE.includes('ZZ-UNDECLARED-LABEL'), false);

  eq('no transitions: a level is assigned from the score, not walked', machine.transitions, {});
  eq('every level is terminal', machine.states.every(s => s.terminal), true);
  eq('unknown_input is reject', machine.policy.unknown_input, 'reject');
  eq('writers are the interview-redflag mode', machine.writers, ['interview-redflag']);
}
