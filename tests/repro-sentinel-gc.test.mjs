// tests/repro-sentinel-gc.test.mjs — KNOWN RED until Phase 3.5.
//
// Bug M5 (docs/STATE-MACHINES-PLAN.md): two sentinel GCs exist. The one that
// verify-pipeline (Check 8) and merge-tracker call — gcStaleSentinels in
// tracker-utils.mjs — is age-only (4h on mtime), unlocked, and ignores the PID
// stored in the sentinel. A sentinel whose owner is STILL ALIVE (e.g. a batch
// worker running >4h or paused by rate limits) is reclaimed, and the next
// reserve-report-num.mjs hands the same report number out again.
// The locked GC in reserve-report-num.mjs does check the PID, so the two
// implementations disagree (last control below).
//
// Only the PID half of the plan's repro is exercised: gc never reads
// batch/batch-state.tsv, so a `processing` batch row would be equally ignored.
//
// Gated behind JOBBER_REPRO=1 (bug case is intentionally red). Default run:
// skipped visibly, zero counters touched.
//   JOBBER_REPRO=1 node test-all.mjs --only repro-sentinel-gc
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nrepro: report-number sentinel GC ignores live owner (M5, known red)');

if (process.env.JOBBER_REPRO !== '1') {
  console.log('  ⏭️  SKIPPED (known-red repro) — set JOBBER_REPRO=1 to run; stays red until Phase 3.5');
} else {
  const work = mkdtempSync(join(tmpdir(), 'repro-sentinel-'));
  try {
    const FIVE_HOURS_S = 5 * 60 * 60;
    // A pid that is certainly dead: a child that already exited.
    const deadPid = spawnSync(NODE, ['-e', '0']).pid;

    // Fresh temp project: empty tracker, empty reports/, one sentinel for #1.
    const makeCase = (name, { pid, ageSeconds }) => {
      const dir = mkdtempSync(join(work, `${name}-`));
      mkdirSync(join(dir, 'reports'));
      mkdirSync(join(dir, 'data'));
      const tracker = join(dir, 'data', 'applications.md');
      writeFileSync(tracker, [
        '# Applications Tracker', '',
        '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
        '|---|------|---------|------|-------|--------|-----|--------|-------|', '',
      ].join('\n'));
      const sentinel = join(dir, 'reports', '001-RESERVED.md');
      writeFileSync(sentinel, JSON.stringify({ pid, token: 'repro', created_at: new Date().toISOString() }));
      const t = new Date(Date.now() - ageSeconds * 1000);
      utimesSync(sentinel, t, t);
      const env = { ...process.env, JOBBER_TRACKER: tracker, JOBBER_REPORTS: join(dir, 'reports'),
        JOBBER_REPORTS_DIR: join(dir, 'reports') };
      return { dir, tracker, sentinel, env, reports: join(dir, 'reports') };
    };
    // Entry point that merge-tracker/verify-pipeline share: verify-pipeline Check 8.
    const runGc = (c) => spawnSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], { env: c.env, encoding: 'utf-8', timeout: 60_000 });
    const reserve = (c) => {
      const r = spawnSync(NODE, [join(ROOT, 'reserve-report-num.mjs')], { env: c.env, encoding: 'utf-8', timeout: 60_000 });
      return r.status === 0 ? r.stdout.trim() : `exit ${r.status}: ${r.stderr.trim()}`;
    };

    // CONTROL 1 — fresh sentinel survives the shared GC.
    try {
      const c = makeCase('fresh', { pid: process.pid, ageSeconds: 60 });
      runGc(c);
      existsSync(c.sentinel) ? pass('CONTROL fresh sentinel kept by verify-pipeline GC')
        : fail('CONTROL fresh sentinel was deleted — fixture or GC broken');
    } catch (e) { warn(`fresh-sentinel control not verified: ${e.message}`); }

    // CONTROL 2 — stale sentinel with a DEAD owner is legitimately reclaimed (GC works at all).
    try {
      const c = makeCase('dead', { pid: deadPid, ageSeconds: FIVE_HOURS_S });
      const r = runGc(c);
      !existsSync(c.sentinel) ? pass('CONTROL stale sentinel with dead owner reclaimed')
        : fail(`CONTROL stale dead-owner sentinel not reclaimed — GC not running? ${r.stdout.slice(-200)}`);
    } catch (e) { warn(`dead-owner control not verified: ${e.message}`); }

    // CONTROL 3 — without any GC, reserve respects the live sentinel and hands out 002.
    try {
      const c = makeCase('nogc', { pid: process.pid, ageSeconds: FIVE_HOURS_S });
      const got = reserve(c);
      got === '002' ? pass('CONTROL reserve alone skips the held number (issues 002)')
        : fail(`CONTROL reserve alone expected 002, got ${got}`);
    } catch (e) { warn(`reserve control not verified: ${e.message}`); }

    // CONTROL 4 — the locked GC in reserve-report-num.mjs DOES honour a live owner.
    try {
      const c = makeCase('locked', { pid: process.pid, ageSeconds: FIVE_HOURS_S });
      const mod = await import(pathToFileURL(join(ROOT, 'reserve-report-num.mjs')).href);
      const removed = await mod.gcStaleReportReservations({ reportsDir: c.reports, trackerPath: c.tracker });
      removed === 0 && existsSync(c.sentinel)
        ? pass('CONTROL locked GC (reserve-report-num) keeps stale sentinel of live owner')
        : fail(`CONTROL locked GC removed=${removed}, sentinel exists=${existsSync(c.sentinel)}`);
    } catch (e) { warn(`locked-GC control not verified: ${e.message}`); }

    // BUG — stale (5h) sentinel, owner PID alive: the shared GC must keep it and
    // reserve must NOT re-issue #1.
    let bug;
    try {
      const c = makeCase('bug', { pid: process.pid, ageSeconds: FIVE_HOURS_S });
      runGc(c);
      bug = { kept: existsSync(c.sentinel), reissued: reserve(c) };
    } catch (e) { warn(`M5 bug case not verified: ${e.message}`); }
    if (bug) {
      if (bug.kept && bug.reissued !== '001') {
        pass('live-owner sentinel survived verify-pipeline GC and #1 was not re-issued');
      } else {
        fail(`live-owner (pid ${process.pid}) 5h-old sentinel 001: kept=${bug.kept}, next reserve-report-num -> "${bug.reissued}" (001 = duplicate number issued while owner still running)`);
      }
    }
  } catch (e) {
    warn(`repro-sentinel-gc harness error: ${e.message}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
