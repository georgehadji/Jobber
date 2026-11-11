// tests/repro-set-status-noncanonical.test.mjs — KNOWN RED until Phase 3.2.
//
// Bug M1 (docs/STATE-MACHINES-PLAN.md): set-status.mjs resolves the row's
// CURRENT status with an exact-label lookup (labelToId.get(...)). A live row
// whose Status cell is non-canonical (alias `Evaluada`, or `Applied 2026-01-05`)
// gets oldId === undefined, transitions[undefined] ?? [] is empty, so the row
// is treated as TERMINAL and the change is refused without --force.
//
// Gated behind JOBBER_REPRO=1 because the bug cases are intentionally red.
// Default run: skipped visibly, zero counters touched.
//   JOBBER_REPRO=1 node test-all.mjs --only repro-set-status
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nrepro: set-status non-canonical oldId (M1, known red)');

if (process.env.JOBBER_REPRO !== '1') {
  console.log('  ⏭️  SKIPPED (known-red repro) — set JOBBER_REPRO=1 to run; stays red until Phase 3.2');
} else {
  const work = mkdtempSync(join(tmpdir(), 'repro-setstatus-'));
  try {
    // Runs set-status on a one-row temp tracker. Returns null when the fixture
    // itself could not be built/run so the caller warns instead of passing.
    const attempt = (existingStatus, target) => {
      const dir = mkdtempSync(join(work, 'case-'));
      mkdirSync(join(dir, 'data'));
      const tracker = join(dir, 'data', 'applications.md');
      writeFileSync(tracker, [
        '# Applications Tracker', '',
        '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
        '|---|------|---------|------|-------|--------|-----|--------|-------|',
        `| 1 | 2026-01-05 | Acme | Platform Engineer | 4.2/5 | ${existingStatus} | ❌ | — | repro |`,
        '',
      ].join('\n'));
      const r = spawnSync(NODE, [join(ROOT, 'set-status.mjs'), '1', target], {
        env: { ...process.env, JOBBER_TRACKER: tracker },
        encoding: 'utf-8', timeout: 60_000,
      });
      if (r.error || r.status === null) return null;
      const after = readFileSync(tracker, 'utf-8').split('\n').find(l => l.startsWith('| 1 |')) ?? '';
      return { code: r.status, out: `${r.stdout}${r.stderr}`.trim(), statusCell: after.split('|')[6]?.trim() };
    };

    const cases = [
      // [label, existing cell, target, expectChange]
      ['CONTROL canonical live row `Evaluated` -> Applied', 'Evaluated', 'Applied', true],
      ['CONTROL terminal row `Rejected` -> Interview stays refused', 'Rejected', 'Interview', false],
      ['BUG alias `Evaluada` -> Applied', 'Evaluada', 'Applied', true],
      ['BUG dated cell `Applied 2026-01-05` -> Interview', 'Applied 2026-01-05', 'Interview', true],
    ];
    for (const [label, existing, target, expectChange] of cases) {
      const res = attempt(existing, target);
      if (!res) { warn(`${label}: fixture/spawn failed — not verified`); continue; }
      const changed = res.code === 0 && res.statusCell === target;
      if (expectChange === changed && (changed || (res.code !== 0 && /terminal state/.test(res.out)))) {
        pass(`${label}: ${changed ? `exit 0, cell now ${res.statusCell}` : 'refused as terminal'}`);
      } else {
        fail(`${label}: expected ${expectChange ? 'change allowed' : 'refusal'}, got exit ${res.code}, cell "${res.statusCell}" — ${res.out.split('\n')[0]}`);
      }
    }
  } catch (e) {
    warn(`repro-set-status harness error: ${e.message}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
