// tests/portal-health-lib.test.mjs — lib/portal-health.mjs is the single home of the portal-health
// failure classification (it was copy-pasted into scan.mjs twice and stats.mjs once, and drifted: D12).
//   1. healthEffect classifies every state the machine declares, and an unknown string counts as a failure
//   2. scan.mjs re-exports the lib's functions (same identity) and stats.mjs gives the same verdict as scan
//      on EVERY status sequence up to length 4 over the whole vocabulary (so a future fork shows up)
//   3. the parser skips the header, blank and short lines
//   4. neither scan.mjs nor stats.mjs re-inlines the neutral-status test
import { pass, fail } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from './helpers.mjs';
import { healthEffect, parsePortalHealthTsv, computeConsecutiveFailures, computePortalSkipTargets } from '../lib/portal-health.mjs';
import * as scan from '../scan.mjs';
import { computePortalStats } from '../stats.mjs';
import { loadMachine } from '../lib/state-machine.mjs';

console.log('\nportal-health lib: one classification, shared by scan and stats');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

// ── 1. classification ──────────────────────────────────────────────────────
const WRITTEN = ['reachable', 'empty', 'rate_limited', 'slug_gone', 'network', 'auth', 'server', 'unknown']; // what the code writes
eq('healthEffect: healthy resets, rate_limited is skipped, every failure kind counts',
  WRITTEN.map(healthEffect), ['reset', 'reset', 'skip', 'count', 'count', 'count', 'count', 'count']);
eq('control: an unrecognised string counts as a failure (the default), never as healthy', [healthEffect('bogus_state'), healthEffect(''), healthEffect(undefined)], ['count', 'count', 'count']);
const machine = loadMachine('portal-health');
const unclassified = machine.states.map((s) => s.id).filter((id) => !['reset', 'skip', 'count'].includes(healthEffect(id)));
eq('every state id the machine declares gets a class', unclassified, []);

// ── 2. scan and stats are the same code, not parallel copies ───────────────
eq('scan.mjs re-exports the lib functions (same identity, not a fork)', [scan.computeConsecutiveFailures === computeConsecutiveFailures, scan.computePortalSkipTargets === computePortalSkipTargets], [true, true]);
{
  const yml = 'tracked_companies:\n  - name: Acme\nportal_health_threshold: 2\n';
  const tsv = (seq) => `timestamp\tcompany\tstatus\n${seq.map((s, i) => `2026-10-01T00:00:0${i}Z\tAcme\t${s}`).join('\n')}\n`;
  const VOCAB = [...WRITTEN, 'bogus_state'];
  let checked = 0, mismatch = null;
  const walk = (prefix, depth) => {
    if (prefix.length) {
      const streak = scan.computeConsecutiveFailures(prefix.map((status, i) => ({ timestamp: `2026-10-01T00:00:0${i}Z`, company: 'Acme', status }))).get('Acme') ?? 0;
      const dead = computePortalStats(yml, null, [], tsv(prefix)).persistentlyDead;
      checked++;
      if ((streak >= 2 ? 1 : 0) !== dead && !mismatch) mismatch = `${prefix.join(',')}: scan streak ${streak}, stats dead ${dead}`;
    }
    if (depth === 0) return;
    for (const v of VOCAB) walk([...prefix, v], depth - 1);
  };
  walk([], 4);
  eq(`stats and scan agree on all ${checked} status sequences up to length 4 (threshold 2)`, mismatch, null);
  eq('control: the comparison saw both outcomes (the fixture can fail)', [computePortalStats(yml, null, [], tsv(['network', 'network'])).persistentlyDead, computePortalStats(yml, null, [], tsv(['network', 'reachable'])).persistentlyDead], [1, 0]);
}

// ── 3. parser ──────────────────────────────────────────────────────────────
eq('parsePortalHealthTsv skips the header, blank lines and short lines, keeps timestamp/company/status',
  parsePortalHealthTsv('timestamp\tcompany\tstatus\n\n2026-10-01T00:00:00Z\tAcme\tnetwork\nshort\tline\n  2026-10-02T00:00:00Z\tBeta\treachable  \n'),
  [{ timestamp: '2026-10-01T00:00:00Z', company: 'Acme', status: 'network' }, { timestamp: '2026-10-02T00:00:00Z', company: 'Beta', status: 'reachable' }]);
eq('control: empty / missing input parses to no records', [parsePortalHealthTsv(''), parsePortalHealthTsv(undefined)], [[], []]);

// ── 4. no re-inlined classification ────────────────────────────────────────
// Static absence check (fails closed). A determined rewrite can evade any static list; the behavioural
// checks above are the real guard.
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
for (const f of ['scan.mjs', 'stats.mjs']) {
  const src = strip(readFileSync(join(ROOT, f), 'utf-8'));
  eq(`${f} does not re-inline the neutral-status test`, /===\s*'rate_limited'|==\s*'rate_limited'/.test(src), false);
}
eq('control: the stripped lib source DOES contain it (so the pattern can match)', /===\s*'rate_limited'/.test(strip(readFileSync(join(ROOT, 'lib', 'portal-health.mjs'), 'utf-8'))), true);
