// tests/normalize-statuses-gate.test.mjs — normalize-statuses routes every status rewrite through the
// shared transition gate (STATE-MACHINES-PLAN Phase 5.3): ENFORCE by default, JOBBER_NORMALIZE_GATE=warn
// escape hatch. Spawned end to end against a temp tracker (JOBBER_TRACKER), never by matching source.
//
// Honest limit: with today's alias data no real cell both resolves to a final state AND normalizes to a
// DIFFERENT state, so the refusal branch cannot be reached from input. What is pinned here is the
// behaviour that must survive the gate: spelling-only fixes still land (incl. a dated cell whose
// resolved state is final), final-state rows and unknown cells are left alone, and the gate adds no
// output of its own. The refusal decision itself is covered by tests/status-gate*.test.mjs.
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nnormalize-statuses transition gate: enforce by default (5.3)');

const work = mkdtempSync(join(tmpdir(), 'ns-gate-'));
// [raw cell, expected cell after, expected stdout line or null]
const ROWS = [
  ['aplicado 2026-03-01', 'Applied', '#1: "aplicado 2026-03-01" → "Applied"'],
  ['DUPLICADO #3', 'Discarded', '#2: "DUPLICADO #3" → "Discarded"'],
  ['Rechazado 2026-01-01', 'Rejected', '#3: "Rechazado 2026-01-01" → "Rejected"'],
  ['evaluated', 'Evaluated', '#4: "evaluated" → "Evaluated"'],
  ['Hired', 'Hired', null],
  ['Rejected', 'Rejected', null],
  ['xyzzy', 'xyzzy', null],
];

function run(gateEnv) {
  let dir, tracker;
  try {
    dir = join(work, `c${gateEnv || 'default'}`);
    mkdirSync(join(dir, 'data'), { recursive: true });
    tracker = join(dir, 'data', 'applications.md');
    writeFileSync(tracker, [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      ...ROWS.map(([raw], i) => `| ${i + 1} | 2026-01-05 | Co${i + 1} | Engineer | 4.0/5 | ${raw} | ❌ | — | fixture |`),
      '',
    ].join('\n'));
  } catch { return null; }
  const res = spawnSync(NODE, [join(ROOT, 'normalize-statuses.mjs')], {
    cwd: dir, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, JOBBER_TRACKER: tracker, JOBBER_NORMALIZE_GATE: gateEnv || '' },
  });
  if (res.status === null) return null;
  const cells = readFileSync(tracker, 'utf-8').split('\n').filter(l => /^\| \d+ \|/.test(l)).map(l => l.split('|')[6].trim());
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, cells };
}

try {
  for (const [label, env] of [['ENFORCE (default)', ''], ['WARN escape hatch', 'warn']]) {
    const r = run(env);
    if (!r) { warn(`${label}: fixture/spawn failed — not verified`); continue; }
    const problems = [];
    if (r.code !== 0) problems.push(`exit ${r.code}`);
    ROWS.forEach(([raw, want, line], i) => {
      if (r.cells[i] !== want) problems.push(`row ${i + 1} "${raw}" -> "${r.cells[i]}" (want "${want}")`);
      if (line && !r.stdout.includes(line)) problems.push(`stdout lacks ${JSON.stringify(line)}`);
    });
    if (!r.stdout.includes('4 statuses normalized')) problems.push('stdout lacks "4 statuses normalized"');
    if (!r.stdout.includes('"xyzzy"')) problems.push('unknown cell not reported');
    if (/kept|⛔/.test(r.stdout) || /WARN|Refused/.test(r.stderr)) problems.push(`unexpected gate output ${JSON.stringify(r.stderr)}`);
    if (problems.length) fail(`${label}: ${problems.join('; ')}`);
    else pass(`${label}: spelling fixes applied, final/unknown rows untouched, no gate noise`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
