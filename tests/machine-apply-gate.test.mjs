// tests/machine-apply-gate.test.mjs — STATE-MACHINES-PLAN Phase 4.5 (M21): the apply-gate machine.
// PROSE ONLY: the states live in modes/apply.md as the `**State:**` line of the
// `## Application Answers` section. This test checks the declaration against that text.
//   - templates/machines/apply-gate.yml loads and validates
//   - every declared state appears as `**State:** <id>` in modes/apply.md (control: a bogus state does not)
//   - the transitions are sane, and `submitted` is reached only by the user (the never-submit rule)
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadMachine } from '../lib/state-machine.mjs';

console.log('\napply-gate machine (Phase 4.5, prose only)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const MODE = readFileSync(join(ROOT, 'modes/apply.md'), 'utf-8');
const AGENTS = readFileSync(join(ROOT, 'AGENTS.md'), 'utf-8');
const hasState = word => MODE.includes(`**State:** ${word}`);

let machine = null;
try {
  machine = loadMachine('apply-gate');
  eq('loads and validates; id is apply-gate', machine.id, 'apply-gate');
} catch (e) {
  fail(`apply-gate.yml failed to load: ${e.message}`);
}

if (machine) {
  const ids = machine.states.map(s => s.id);
  eq('declares exactly the two states the mode names (filled, submitted)', ids.sort(), ['filled', 'submitted']);

  for (const s of machine.states) {
    eq(`"${s.id}" appears as **State:** ${s.id} in modes/apply.md`, hasState(s.id), true);
  }
  eq('control: a bogus state is NOT found in modes/apply.md', hasState('zz-undeclared-state'), false);
  eq('control: a state the mode never writes ("not-started") is not declared', ids.includes('not-started'), false);

  eq('initial is filled (the snapshot is first written with --state filled)', machine.initial, 'filled');
  eq('filled -> submitted is the only forward edge', machine.transitions, { filled: ['submitted'] });
  const terminal = Object.fromEntries(machine.states.map(s => [s.id, s.terminal]));
  eq('filled is live, submitted is terminal', terminal, { filled: false, submitted: true });
  eq('no self-loops and every edge endpoint is declared', Object.entries(machine.transitions).every(([from, tos]) => tos.every(t => t !== from && ids.includes(t)) && ids.includes(from)), true);

  const submitted = machine.states.find(s => s.id === 'submitted');
  eq('submitted is performed by the user, not the agent (description says so)', /user/i.test(submitted.description) && /never/i.test(submitted.description), true);
  eq('the never-submit rule is stated in AGENTS.md (control: a bogus rule text is absent)', [AGENTS.includes('NEVER submit an application without the user reviewing it first'), AGENTS.includes('zz-never-bogus-rule')], [true, false]);
  eq('unknown_input is reject', machine.policy.unknown_input, 'reject');
  eq('writers are the apply mode', machine.writers, ['apply']);
}
