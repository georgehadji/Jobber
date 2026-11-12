// tests/machine-scan-history.test.mjs — STATE-MACHINES-PLAN Phase 4.5 (M13): the scan-history machine.
// Parity: every status string any writer can put in data/scan-history.tsv (scan.mjs, scan-interamt.mjs,
// modes/scan.md) is a state of templates/machines/scan-history.yml; the dedup rule the machine documents
// (only `added` can lapse; everything else is permanent) is what shouldDedupScanHistoryRow does today.
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadMachine, canonicalize, check } from '../lib/state-machine.mjs';
import { shouldDedupScanHistoryRow } from '../scan.mjs';
import { classifyLiveness } from '../liveness-core.mjs';
import { rejectPrivateOrInvalid } from '../liveness-browser.mjs';

console.log('\nscan-history state machine (Phase 4.5 / M13)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const src = f => readFileSync(join(ROOT, f), 'utf-8').replace(/\r\n/g, '\n');
const machine = loadMachine('scan-history');
const ids = machine.states.map(s => s.id);
// A row's status maps to a state by its text before the first colon (cooldown:<company>:<date> is a pattern).
const stateOf = status => canonicalize(machine, String(status).startsWith('cooldown:') ? 'cooldown' : status)?.id ?? null;
const SKIPPED = ids.filter(i => i.startsWith('skipped_'));

// ── loads valid ───────────────────────────────────────────────────────────
eq('loads via loadMachine with the 10 declared states', ids, ['added', 'skipped_expired', 'skipped_no_apply_control', 'skipped_invalid_url', 'skipped_blocked_host', 'skipped_title', 'skipped_location', 'skipped_date', 'skipped_dup', 'cooldown']);
eq('initial is added; every skipped_* is terminal; added and cooldown are not', [machine.initial, machine.states.filter(s => s.terminal).map(s => s.id)], ['added', SKIPPED]);
eq('the cooldown pattern maps to its state; a different prefix does not (control)', [stateOf('cooldown:Acme:2026-12-01'), stateOf('cooldowns:Acme')], ['cooldown', null]);

// ── parity: every status a writer can emit is declared ───────────────────
const skippedTokens = text => [...new Set([...text.matchAll(/\bskipped_[a-z_]+\b/g)].map(m => m[0]))].sort();
{
  eq('control: the extractor finds skipped_* tokens', skippedTokens('x skipped_one y\nskipped_two skipped_one'), ['skipped_one', 'skipped_two']);
  eq('control: an undeclared skipped_* token is NOT known to the machine', stateOf('skipped_bogus'), null);
  const writers = ['scan.mjs', 'scan-interamt.mjs', 'modes/scan.md'];
  const all = new Set();
  for (const f of writers) {
    const toks = skippedTokens(src(f));
    eq(`control: ${f} was read and names at least one skipped_* status`, toks.length > 0, true);
    eq(`${f}: every skipped_* status it names is declared`, toks.filter(t => !stateOf(t)), []);
    toks.forEach(t => all.add(t));
  }
  eq('together the writers use exactly the 8 declared skipped_* states (none declared but unused)', [...all].sort(), [...SKIPPED].sort());
}
{
  // scan-interamt.mjs writes through appendToScanHistory(..., '<status>'): read the literal argument too.
  const lits = [...src('scan-interamt.mjs').matchAll(/appendToScanHistory\([^,]+,\s*date,\s*'([^']+)'\)/g)].map(m => m[1]).sort();
  eq('scan-interamt.mjs passes exactly these literal statuses', lits, ['added', 'skipped_date', 'skipped_dup', 'skipped_location', 'skipped_title']);
  eq('...all declared', lits.filter(l => !stateOf(l)), []);
  const s = src('scan.mjs');
  eq('appendToScanHistory and formatScanHistoryRow default status to `added`', (s.match(/status = 'added'\)/g) || []).length >= 2, true);
  eq('scan.mjs cooldown rows are built as cooldown:<company>:<date>', /reason: `cooldown:\$\{windowCompany\}:\$\{cooldownUntil\}`/.test(s), true);
  const guard = /function guardStatusFor[^{]*{([^}]*)}/.exec(s)?.[1] ?? '';
  eq('guardStatusFor returns skipped_blocked_host for blocked_host, else skipped_invalid_url', [...guard.matchAll(/return '(skipped_[a-z_]+)'/g)].map(m => m[1]), ['skipped_blocked_host', 'skipped_invalid_url']);
}

// ── liveness vocabulary -> status mapping ────────────────────────────────
{
  const BIG = 'x'.repeat(2000);
  const dead = classifyLiveness({ status: 404 });
  const noApply = classifyLiveness({ status: 200, requestedUrl: 'https://a.co/p', finalUrl: 'https://a.co/p', bodyText: BIG, applyControls: [] });
  const live = classifyLiveness({ status: 200, requestedUrl: 'https://a.co/p', finalUrl: 'https://a.co/p', bodyText: BIG, applyControls: ['Apply now'] });
  eq('classifyLiveness results: expired / uncertain+no_apply_control / active', [dead.result, noApply.result + '+' + noApply.code, live.result], ['expired', 'uncertain+no_apply_control', 'active']);
  eq('control: the three results are distinct (a constant classifier would fail this)', new Set([dead.result, noApply.result, live.result]).size, 3);
  eq('guard codes from rejectPrivateOrInvalid are the three scan.mjs routes to skipped_*',
    [rejectPrivateOrInvalid('not a url')?.code, rejectPrivateOrInvalid('ftp://a.co/x')?.code, rejectPrivateOrInvalid('http://127.0.0.1/x')?.code, rejectPrivateOrInvalid('https://example.com/x')],
    ['invalid_url', 'unsupported_protocol', 'blocked_host', null]);
}

// ── dedup rule: only `added` lapses (the KNOWN PROBLEM, pinned) ──────────
{
  const old = { firstSeen: '2020-01-01' };
  const policy = { recheckAfterDays: 0, today: '2026-11-12' };
  eq('control: an old `added` row IS rechecked when recheckAfterDays is set (not deduped)', shouldDedupScanHistoryRow({ ...old, status: 'added' }, policy), false);
  eq('control: ...and is deduped when recheckAfterDays is unset', shouldDedupScanHistoryRow({ ...old, status: 'added' }, { today: '2026-11-12' }), true);
  for (const s of SKIPPED) {
    eq(`${s}: deduped even when old and recheckAfterDays is 0 (permanent; terminal in the machine)`, shouldDedupScanHistoryRow({ ...old, status: s }, policy), true);
  }
  eq('KNOWN PROBLEM: a (possibly false) skipped_expired is NOT rechecked by recheck_after_days, contrary to the plan wording', shouldDedupScanHistoryRow({ ...old, status: 'skipped_expired' }, { recheckAfterDays: 1, today: '2026-11-12' }), true);
  eq('cooldown dedups while today is before its date...', shouldDedupScanHistoryRow({ ...old, status: 'cooldown:Acme:2999-01-01' }, policy), true);
  eq('...and lapses after it (so cooldown is the one non-added state that is not permanent)', shouldDedupScanHistoryRow({ ...old, status: 'cooldown:Acme:2000-01-01' }, policy), false);
  eq('an unrecognised status is deduped like a skipped_* row (policy unknown_input: flag, never rejected)', shouldDedupScanHistoryRow({ ...old, status: 'bogus_state' }, policy), true);
  eq('machine terminal flag agrees with the code: terminal <=> deduped forever',
    ids.map(i => [i, machine.states.find(s => s.id === i).terminal === (i !== 'added' && i !== 'cooldown')]).filter(([, ok]) => !ok), []);
}

// ── check() kinds ────────────────────────────────────────────────────────
eq('check: added -> skipped_expired is a declared move', check(machine, 'added', 'skipped_expired').kind, 'forward');
eq('check: cooldown -> added (lapsed window) is a declared move', check(machine, 'cooldown', 'added').kind, 'forward');
eq('check: leaving a terminal state (skipped_expired -> added) needs force: terminal-exit, ok:false', [check(machine, 'skipped_expired', 'added').kind, check(machine, 'skipped_expired', 'added').ok], ['terminal-exit', false]);
eq('check: added -> skipped_title is not a declared edge: allowed as a correction', check(machine, 'added', 'skipped_title').kind, 'correction');
eq('check: an undeclared target is unknown-to (control)', check(machine, 'added', 'skipped_bogus').kind, 'unknown-to');
