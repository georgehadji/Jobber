// tests/machine-agent-inbox.test.mjs — STATE-MACHINES-PLAN Phase 4.5 (M16): agent-inbox machine.
// Spawns the real agent-inbox.mjs against a throwaway JOBBER_INBOX and compares what it writes/reads
// with templates/machines/agent-inbox.yml. Declaration only; nothing is enforced.
import { pass, fail, warn, ROOT, NODE } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { loadMachine, canonicalize, check } from '../lib/state-machine.mjs';

console.log('\nagent-inbox state machine (Phase 4.5 / M16)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const machine = loadMachine('agent-inbox');
eq('loads valid: initial pending, resolved is the only terminal state', [machine.initial, machine.states.filter(s => s.terminal).map(s => s.id)], ['pending', ['resolved']]);

let tmp;
try { tmp = mkdtempSync(join(tmpdir(), 'jobber-inbox-sm-')); } catch (e) { warn(`agent-inbox sandbox could not be built: ${e.message}`); }
if (tmp) {
  try {
    const file = join(tmp, 'agent-inbox.md');
    const env = { ...process.env, JOBBER_INBOX: file };
    const cli = (...args) => { const r = spawnSync(NODE, [join(ROOT, 'agent-inbox.mjs'), ...args], { cwd: tmp, env, encoding: 'utf-8', timeout: 30000 }); return { status: r.status, out: r.stdout || '', err: r.stderr || '' }; };
    const items = () => readFileSync(file, 'utf-8').split('\n').filter(l => /^- \[.\]/.test(l));
    const box = line => /^- \[(.)\]/.exec(line)[1];

    cli('add', 'first request');
    cli('add', 'second request');
    const added = items();
    // the checkbox glyph written by `add` is the pending state
    eq('add writes `[ ]`, which canonicalizes to pending', [added.map(box), canonicalize(machine, '[ ]')?.id], [[' ', ' '], 'pending']);

    cli('resolve', '1', '--result', 'done it');
    const after = items();
    eq('resolve writes `[x]` (+ result suffix), which canonicalizes to resolved',
      [box(after[0]), after[0].endsWith('→ result: done it'), canonicalize(machine, '[x]')?.id, box(after[1])], ['x', true, 'resolved', ' ']);
    eq('...and the resolved item leaves the pending view (list hides it, list --all shows it)',
      [cli('list').out.includes('first request'), cli('list', '--all').out.includes('first request')], [false, true]);

    // hand-edited upper-case X is accepted by the parser and is the same state (alias lookup lowercases)
    writeFileSync(file, readFileSync(file, 'utf-8').replace('- [ ] ', '- [X] '));
    eq('`[X]` typed by hand is treated as resolved by the script and canonicalizes to resolved',
      [cli('list').out.includes('second request'), canonicalize(machine, '[X]')?.id], [false, 'resolved']);

    // control: a checkbox glyph outside the machine is not an item at all (so the glyph set above is not vacuous)
    writeFileSync(file, `${readFileSync(file, 'utf-8')}- [?] mystery\n`);
    eq('control: `[?]` is not parsed as an item and is not a machine state', [cli('list', '--all').out.includes('mystery'), canonicalize(machine, '[?]')], [false, null]);

    // Known hazard pinned (declared, not fixed): `resolve N` is positional on the PENDING view.
    writeFileSync(file, '# Agent Inbox\n\n- [ ] A\n- [ ] B\n- [ ] C\n');
    cli('resolve', '1'); // resolves A; B is now pending #1
    cli('resolve', '1'); // a stale "1" from before now resolves B, not A
    eq('known hazard pinned: the same `resolve 1` issued twice resolves two different items (A then B)', items().map(box), ['x', 'x', ' ']);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ── check() kinds ──
eq('pending -> resolved is a declared forward move', check(machine, '[ ]', '[x]').kind, 'forward');
eq('resolved -> pending (a hand un-check) leaves the terminal state: needs an override', [check(machine, 'resolved', 'pending').kind, check(machine, 'resolved', 'pending').ok], ['terminal-exit', false]);
eq('an unknown glyph is unknown-to', check(machine, 'pending', '[?]').kind, 'unknown-to');
