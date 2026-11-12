// tests/go-states.test.mjs — STATE-MACHINES-PLAN Phase 4.2: the dashboard's generated registry.
//   - dashboard/internal/data/states_gen.go equals a fresh render of templates/states.yml
//   - controls: a tampered registry renders a DIFFERENT file; --check on a stale copy exits 1
//     with the regenerate hint; a missing copy is reported missing, not stale-but-ok
//   - the generated file carries its "do not edit" header and the validator-visible markers
import { pass, fail, warn, ROOT, NODE } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, cpSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { loadMachine } from '../lib/state-machine.mjs';
import { renderGo, OUT_REL } from '../gen-go-states.mjs';

console.log('\ngo dashboard state registry (Phase 4.2)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const norm = t => t.replace(/\r\n/g, '\n');
const machine = loadMachine('application-status');
const committed = norm(readFileSync(join(ROOT, OUT_REL), 'utf-8'));

eq('states_gen.go equals a fresh render of templates/states.yml', committed === renderGo(machine), true);
eq('the header says GENERATED — do not edit', committed.startsWith('// GENERATED — do not edit.'), true);
eq('every registry state appears with its id and label', machine.states.every(s => committed.includes(`{ID: "${s.id}", Label: "${s.label}", Terminal: ${s.terminal}`)), true);

// control: remove one label from the machine and the render must differ from the committed file
const tampered = { ...machine, states: machine.states.map((s, i) => (i === 0 ? { ...s, label: s.label + 'X' } : s)) };
eq('control: a registry with one label changed renders a DIFFERENT file (staleness is detectable)', renderGo(tampered) !== committed, true);
const lessEdge = { ...machine, transitions: { ...machine.transitions, applied: [] } };
eq('control: a registry with one edge removed renders a DIFFERENT file', renderGo(lessEdge) !== committed, true);

const cli = spawnSync(NODE, [join(ROOT, 'gen-go-states.mjs'), '--check'], { encoding: 'utf-8' });
eq('gen-go-states.mjs --check exits 0 on the committed file', [cli.status, cli.stderr], [0, '']);

// stale / missing copies in a throwaway root (setup failure is a warn, never a pass)
let tmp;
try {
  tmp = mkdtempSync(join(tmpdir(), 'go-states-'));
  mkdirSync(join(tmp, 'templates'), { recursive: true });
  mkdirSync(join(tmp, 'dashboard/internal/data'), { recursive: true });
  cpSync(join(ROOT, 'templates/states.yml'), join(tmp, 'templates/states.yml'));
} catch (e) {
  warn(`go-states sandbox could not be built: ${e.message}`);
  tmp = null;
}
if (tmp) {
  try {
    const run = () => spawnSync(NODE, [join(ROOT, 'gen-go-states.mjs'), '--check', '--root', tmp], { encoding: 'utf-8' });
    const missing = run();
    eq('control: --check on a root with no generated file exits 1 and says missing', [missing.status, /missing/.test(missing.stderr)], [1, true]);
    writeFileSync(join(tmp, OUT_REL), committed);
    eq('--check on a fresh copy exits 0', run().status, 0);
    writeFileSync(join(tmp, OUT_REL), committed.replace('Label: "Applied"', 'Label: "Applied2"'));
    const stale = run();
    eq('control: --check on a hand-edited copy exits 1 with the regenerate hint', [stale.status, /Run: node gen-go-states\.mjs/.test(stale.stderr)], [1, true]);
    const yml = readFileSync(join(tmp, 'templates/states.yml'), 'utf-8');
    writeFileSync(join(tmp, 'templates/states.yml'), yml.replace('label: Offer', 'label: Offer2'));
    writeFileSync(join(tmp, OUT_REL), committed);
    eq('control: --check after the registry changed (copy not regenerated) exits 1', run().status, 1);
    eq('rewrite mode regenerates, then --check passes again', [spawnSync(NODE, [join(ROOT, 'gen-go-states.mjs'), '--root', tmp]).status, run().status], [0, 0]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
