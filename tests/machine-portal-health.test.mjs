// tests/machine-portal-health.test.mjs — STATE-MACHINES-PLAN Phase 4.5 (M12): the portal-health machine.
// Parity: every status string the code writes or reads (portal-health.tsv, verify-portals, provider-health,
// discover-ats, classifyFetchError) is a state or alias of templates/machines/portal-health.yml, and the
// streak classes the machine documents are what scan.mjs / stats.mjs actually do today (incl. the drift).
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadMachine, canonicalize, check } from '../lib/state-machine.mjs';
import { computeConsecutiveFailures, computePortalSkipTargets } from '../scan.mjs';
import { computePortalStats } from '../stats.mjs';
import { classifyFetchError } from '../lib/http-errors.mjs';

console.log('\nportal-health state machine (Phase 4.5 / M12)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const src = f => readFileSync(join(ROOT, f), 'utf-8').replace(/\r\n/g, '\n');
const machine = loadMachine('portal-health');
const ids = machine.states.map(s => s.id);
const known = s => canonicalize(machine, s)?.id ?? null;

// ── loads valid ───────────────────────────────────────────────────────────
eq('loads via loadMachine with the 9 declared states', ids, ['unprobed', 'reachable', 'empty', 'rate_limited', 'slug_gone', 'network', 'auth', 'server', 'unknown']);
eq('initial is unprobed and nothing is terminal (an append-only log: any status can follow any)', [machine.initial, machine.states.filter(s => s.terminal).length], ['unprobed', 0]);
eq('unknown strings fold into `unknown` (policy map:unknown), matching "unknown counts as failure"', machine.policy.unknown_input, 'map:unknown');

// ── parity: what the code can write ──────────────────────────────────────
// classifyFetchError is the only source of error kinds in portal-health.tsv. Drive every branch.
{
  const probes = [
    null, { name: 'AbortError' }, { message: 'ECONNREFUSED' }, { status: 429 }, { message: 'HTTP 429' },
    { status: 404 }, { status: 410 }, { message: 'HTTP 404' }, { status: 401 }, { status: 403 }, { message: 'HTTP 403' },
    { status: 500 }, { status: 503 }, { message: 'HTTP 502' }, { status: 418 }, { message: 'weird' },
  ];
  const kinds = [...new Set(probes.map(classifyFetchError))].sort();
  eq('classifyFetchError yields exactly the six kinds the machine declares as failure/neutral states', kinds, ['auth', 'network', 'rate_limited', 'server', 'slug_gone', 'unknown']);
  eq('every classifyFetchError kind is a declared state id (not merely an alias)', kinds.every(k => ids.includes(k)), true);
}
{
  // scan.mjs:~2617-2627 — the two healthy literals it writes itself.
  const s = src('scan.mjs');
  const a = s.indexOf('const errorKindByCompany');
  const b = s.indexOf('healthRecords.push', a);
  const block = a >= 0 && b > a ? s.slice(a, b) : '';
  eq('control: the portal-health write block was located in scan.mjs', block.length > 0, true);
  const literals = [...new Set([...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1]))].sort();
  eq('scan.mjs writes only `reachable` and `empty` itself, on top of the classifier kinds', literals, ['empty', 'reachable']);
  eq('...and both are declared state ids', literals.every(l => ids.includes(l)), true);
}

// ── parity: the other three vocabularies ─────────────────────────────────
function statusLiterals(text) {
  const out = new Set();
  for (const line of text.split('\n')) {
    if (/^\s*(\*|\/\/)/.test(line)) continue; // comment lines
    if (!/\bstatus\s*(:|===|!==|=)/.test(line)) continue;
    for (const m of line.matchAll(/'([a-z_]+)'/g)) out.add(m[1]);
  }
  return [...out].sort();
}
{
  // control for the extractor: it must see a bogus literal and ignore comments, or the parity below is vacuous
  const fake = "// status: 'commented'\n const r = { status: 'bogus_state' };\n if (x.status === 'also_bogus') {}\n";
  eq('control: the extractor finds literals on code lines and skips comment lines', statusLiterals(fake), ['also_bogus', 'bogus_state']);
  eq('control: a bogus literal is NOT known to the machine', ['bogus_state', 'also_bogus'].map(known), [null, null]);
}
const VOCAB = {
  'verify-portals.mjs': ['empty', 'live', 'missing', 'skipped'],
  'provider-health.mjs': ['degraded', 'down', 'healthy', 'skipped'],
  'discover-ats.mjs': ['empty', 'error', 'match', 'none', 'unverified'],
};
for (const [file, want] of Object.entries(VOCAB)) {
  const got = statusLiterals(src(file));
  eq(`${file} status vocabulary is exactly what the machine was written against`, got, want);
  eq(`...and every one of its spellings is a state or alias of portal-health`, got.filter(g => !known(g)), []);
}
eq('alias mapping: live/healthy/match -> reachable; missing -> slug_gone; down -> network; error -> unknown; skipped/unverified/none -> unprobed; degraded -> server',
  ['live', 'healthy', 'match', 'missing', 'down', 'error', 'skipped', 'unverified', 'none', 'degraded'].map(known),
  ['reachable', 'reachable', 'reachable', 'slug_gone', 'network', 'unknown', 'unprobed', 'unprobed', 'unprobed', 'server']);

// ── parity: streak classes the machine documents == what the code does ───
const rec = (status, i) => ({ timestamp: `2026-10-0${i}T00:00:00Z`, company: 'Acme', status });
// [failure, X]: healthy -> 0, neutral -> 1 (unchanged), failure -> 2
const scanStreak = x => computeConsecutiveFailures([rec('network', 1), rec(x, 2)]).get('Acme');
const klass = n => (n === 0 ? 'healthy' : n === 1 ? 'neutral' : 'failure');
const EXPECT_SCAN = { reachable: 'healthy', empty: 'healthy', rate_limited: 'neutral', slug_gone: 'failure', network: 'failure', auth: 'failure', server: 'failure', unknown: 'failure' };
for (const [state, want] of Object.entries(EXPECT_SCAN)) {
  eq(`scan.mjs computeConsecutiveFailures treats \`${state}\` as ${want}`, klass(scanStreak(state)), want);
}
eq('an unrecognised string counts as a FAILURE in scan.mjs (today\'s behaviour, pinned not changed)', klass(scanStreak('bogus_state')), 'failure');
eq('...so does a vocabulary alias written raw (`down`) and `skipped`: the log is never canonicalized', [klass(scanStreak('down')), klass(scanStreak('skipped'))], ['failure', 'failure']);
{
  // computePortalSkipTargets is the second copy of the same classification
  const skipFor = x => computePortalSkipTargets([rec('network', 1), rec('network', 2), rec(x, 3)], { threshold: 3, now: Date.parse('2026-10-03T12:00:00Z') }).has('Acme');
  eq('computePortalSkipTargets agrees: server extends the streak to the skip threshold', skipFor('server'), true);
  eq('control: reachable resets it (no skip)', skipFor('reachable'), false);
  eq('control: rate_limited is neutral there too (2 failures stay below 3)', skipFor('rate_limited'), false);
}

// ── DRIFT pinned: stats.mjs has no neutral class ─────────────────────────
{
  const yml = 'tracked_companies:\n  - name: Acme\nportal_health_threshold: 1\n';
  const tsv = rows => `timestamp\tcompany\tstatus\n${rows.map((s, i) => `2026-10-0${i + 1}T00:00:00Z\tAcme\t${s}`).join('\n')}\n`;
  const dead = rows => computePortalStats(yml, null, [], tsv(rows)).persistentlyDead;
  eq('stats.mjs: network after reachable is persistently dead at threshold 1 (control)', dead(['reachable', 'network']), 1);
  eq('stats.mjs: reachable resets (control)', dead(['network', 'reachable']), 0);
  eq('stats.mjs: empty resets (control)', dead(['network', 'empty']), 0);
  eq('DRIFT: stats.mjs counts rate_limited as a failure', dead(['reachable', 'rate_limited']), 1);
  eq('...while scan.mjs leaves the same history un-failed (streak 0 after reachable, rate_limited)', computeConsecutiveFailures([rec('reachable', 1), rec('rate_limited', 2)]).get('Acme'), 0);
  eq('the machine documents rate_limited as neutral-in-scan (description names the drift)', /FAILURE by stats\.mjs/.test(machine.states.find(s => s.id === 'rate_limited').description), true);
}

// ── check() kinds ────────────────────────────────────────────────────────
eq('check: unprobed -> reachable is a declared forward move', check(machine, 'unprobed', 'reachable').kind, 'forward');
eq('check: network -> reachable (recovery) is a declared forward move', check(machine, 'network', 'reachable').kind, 'forward');
eq('check: an alias is canonicalized (down -> live == network -> reachable)', check(machine, 'down', 'live').kind, 'forward');
eq('check: reachable -> reachable is a noop', check(machine, 'reachable', 'reachable').kind, 'noop');
eq('check: an undeclared target is unknown-to and refused (control)', [check(machine, 'reachable', 'bogus_state').kind, check(machine, 'reachable', 'bogus_state').ok], ['unknown-to', false]);
eq('check: an unknown source is a warning, never terminal', [check(machine, 'bogus_state', 'reachable').kind, check(machine, 'bogus_state', 'reachable').ok], ['unknown-from', true]);
