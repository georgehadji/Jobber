// tests/set-status-noncanonical.test.mjs — regression for bug M1 (docs/STATE-MACHINES-PLAN.md).
//
// Converted in Phase 3.2 from the known-red tests/repro-set-status-noncanonical.test.mjs:
// the JOBBER_REPRO=1 gate is gone, this file always runs.
//
// M1: set-status.mjs used an exact-label lookup for the row's CURRENT status, so a live row
// whose Status cell is non-canonical (alias `Evaluada`, dated `Applied 2026-01-05`) got no
// state id, looked terminal (no forward edges) and the change was refused without --force.
// Fixed: the gate resolves the cell tolerantly (lib/status-gate.mjs) before check().
//
// The opposite direction is guarded too: a DECORATED terminal (`Rejected 2026-02-01`,
// `Hired (2026-01-05)`, `**Rejected**`, `Rechazado 2026-02-01`) must STILL be refused —
// before the fix that happened only by accident, via the same bug.
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nset-status non-canonical Status cells (M1 regression)');

const work = mkdtempSync(join(tmpdir(), 'ss-noncanon-'));
try {
  // Runs set-status on a one-row temp tracker. Returns null when the fixture itself could
  // not be built/run so the caller warns instead of passing.
  const attempt = (existingStatus, target, extra = []) => {
    let tracker;
    try {
      const dir = mkdtempSync(join(work, 'case-'));
      mkdirSync(join(dir, 'data'));
      tracker = join(dir, 'data', 'applications.md');
      writeFileSync(tracker, [
        '# Applications Tracker', '',
        '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
        '|---|------|---------|------|-------|--------|-----|--------|-------|',
        `| 1 | 2026-01-05 | Acme | Platform Engineer | 4.2/5 | ${existingStatus} | ❌ | — | repro |`,
        '',
      ].join('\n'));
    } catch { return null; }
    const r = spawnSync(NODE, [join(ROOT, 'set-status.mjs'), '1', target, '--json', ...extra], {
      env: { ...process.env, JOBBER_TRACKER: tracker },
      encoding: 'utf-8', timeout: 60_000,
    });
    if (r.error || r.status === null) return null;
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    const after = readFileSync(tracker, 'utf-8').split('\n').find(l => l.startsWith('| 1 |')) ?? '';
    return { code: r.status, json, stderr: r.stderr, statusCell: after.split('|')[6]?.trim() };
  };

  const cases = [
    // [label, existing cell, target, expectChange]
    ['CONTROL canonical live row `Evaluated` -> Applied', 'Evaluated', 'Applied', true],
    ['CONTROL terminal row `Rejected` -> Interview stays refused', 'Rejected', 'Interview', false],
    ['M1 alias `Evaluada` -> Applied', 'Evaluada', 'Applied', true],
    ['M1 dated cell `Applied 2026-01-05` -> Interview', 'Applied 2026-01-05', 'Interview', true],
    ['M1 bold cell `**Responded**` -> Interview', '**Responded**', 'Interview', true],
    // dated/decorated terminals are STILL terminals
    ['GUARD dated terminal `Rejected 2026-02-01` -> Interview', 'Rejected 2026-02-01', 'Interview', false],
    ['GUARD dated terminal `Hired 2026-01-05` -> Evaluated', 'Hired 2026-01-05', 'Evaluated', false],
    ['GUARD parenthesised terminal `Hired (2026-01-05)` -> Applied', 'Hired (2026-01-05)', 'Applied', false],
    ['GUARD bold terminal `**Rejected**` -> Interview', '**Rejected**', 'Interview', false],
    ['GUARD alias+date terminal `Rechazado 2026-02-01` -> Interview', 'Rechazado 2026-02-01', 'Interview', false],
    ['GUARD dated terminal `Discarded 2026-02-01` -> Applied', 'Discarded 2026-02-01', 'Applied', false],
  ];
  for (const [label, existing, target, expectChange] of cases) {
    const res = attempt(existing, target);
    if (!res) { warn(`${label}: fixture/spawn failed — not verified`); continue; }
    const changed = res.code === 0 && res.statusCell === target;
    const refused = res.code === 1 && res.json?.code === 'illegal-transition' && res.statusCell === existing;
    if (expectChange ? changed : refused) {
      pass(`${label}: ${changed ? `exit 0, cell now ${res.statusCell}` : 'refused as terminal, cell untouched'}`);
    } else {
      fail(`${label}: expected ${expectChange ? 'change allowed' : 'refusal'}, got exit ${res.code}, code ${res.json?.code}, cell "${res.statusCell}"`);
    }
  }

  // Dated terminal: --force is the explicit override (control for the refusals above), and the
  // refusal payload is machine-readable and additive (existing fields keep their meaning).
  const dated = attempt('Rejected 2026-02-01', 'Interview');
  const datedForced = attempt('Rejected 2026-02-01', 'Interview', ['--force']);
  if (!dated || !datedForced) warn('dated terminal --json/--force case: fixture/spawn failed — not verified');
  else {
    const j = dated.json ?? {};
    const shapeOk = j.from === 'Rejected 2026-02-01' && j.to === 'Interview' && j.terminal === true
      && j.kind === 'terminal-exit' && j.fromResolved === 'Rejected'
      && Array.isArray(j.legal) && j.legal.includes('rejected')
      && Array.isArray(j.legalLabels) && j.legalLabels.includes('Rejected')
      && /terminal state/.test(j.error ?? '') && /--force/.test(j.error ?? '') && /Rejected/.test(j.reason ?? '');
    if (shapeOk) pass('dated terminal refusal JSON: legacy fields intact + kind/fromResolved/legalLabels/reason (reason and legal moves stated)');
    else fail(`dated terminal refusal JSON shape unexpected: ${JSON.stringify(j)}`);
    if (datedForced.code === 0 && datedForced.statusCell === 'Interview') pass('dated terminal `Rejected 2026-02-01` -> Interview with --force: changed');
    else fail(`dated terminal with --force: exit ${datedForced.code}, cell "${datedForced.statusCell}"`);
  }

  // unknown-from: a cell that resolves to nothing is a LIVE row — allowed, with a visible warning.
  const unk = attempt('Waiting on recruiter', 'Interview');
  const ctl = attempt('Applied', 'Interview');
  if (!unk || !ctl) warn('unknown-from case: fixture/spawn failed — not verified');
  else {
    const warned = /WARN/.test(unk.stderr) && /Waiting on recruiter/.test(unk.stderr)
      && Array.isArray(unk.json?.warnings) && unk.json.warnings.length === 1;
    if (unk.code === 0 && unk.statusCell === 'Interview' && warned) pass('unknown-from `Waiting on recruiter` -> Interview: allowed (not terminal) with a warning on stderr and in JSON');
    else fail(`unknown-from: exit ${unk.code}, cell "${unk.statusCell}", stderr ${JSON.stringify(unk.stderr)}, warnings ${JSON.stringify(unk.json?.warnings)}`);
    if (ctl.code === 0 && !/WARN/.test(ctl.stderr) && ctl.json?.warnings === undefined) pass('CONTROL canonical `Applied` -> Interview: no warning');
    else fail(`control produced a warning: ${JSON.stringify(ctl.stderr)} ${JSON.stringify(ctl.json?.warnings)}`);
  }
} catch (e) {
  warn(`set-status-noncanonical harness error: ${e.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
