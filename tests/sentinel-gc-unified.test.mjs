// tests/sentinel-gc-unified.test.mjs — Phase 3.5 (M5): one locked sentinel GC
// that never reclaims a sentinel that is still owned (fresh / live PID /
// batch-state `processing` row). Each case has its opposite as a control.
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nunified report-number sentinel GC (M5)');

const work = mkdtempSync(join(tmpdir(), 'sentinel-gc-unified-'));
const HOUR_S = 3600;
const BATCH_HEADER = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n';
let mods = null;
let deadPid = 0;
try {
  const tu = await import(pathToFileURL(join(ROOT, 'tracker-utils.mjs')).href);
  const rr = await import(pathToFileURL(join(ROOT, 'reserve-report-num.mjs')).href);
  mods = { tu, rr };
  deadPid = spawnSync(NODE, ['-e', '0']).pid; // child already exited
} catch (e) {
  warn(`sentinel-gc-unified setup failed, nothing verified: ${e.message}`);
}

if (mods) {
  const { tu, rr } = mods;
  let n = 0;
  // batchRows: array of [status, reportNum], or null for no batch-state file.
  const makeCase = ({ pid, ageHours, batchRows = null }) => {
    const dir = mkdtempSync(join(work, `c${n++}-`));
    mkdirSync(join(dir, 'reports'));
    mkdirSync(join(dir, 'data'));
    mkdirSync(join(dir, 'batch'));
    const tracker = join(dir, 'data', 'applications.md');
    writeFileSync(tracker, '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
    const sentinel = join(dir, 'reports', '007-RESERVED.md');
    writeFileSync(sentinel, JSON.stringify({ pid, token: 't', created_at: new Date().toISOString() }));
    const t = new Date(Date.now() - ageHours * HOUR_S * 1000);
    utimesSync(sentinel, t, t);
    const batchState = join(dir, 'batch', 'batch-state.tsv');
    if (batchRows) {
      writeFileSync(batchState, BATCH_HEADER + batchRows
        .map(([status, num], i) => `${i + 1}\thttps://x/${i}\t${status}\t-\t-\t${num}\t-\t-\t0\n`).join(''));
    }
    return { dir, tracker, sentinel, reports: join(dir, 'reports'), batchState };
  };
  const gc = (c) => tu.gcStaleReportSentinels({
    reportsDir: c.reports, trackerPath: c.tracker, batchStatePath: c.batchState,
  });

  const expectCase = async (label, spec, shouldRemove) => {
    let c;
    try { c = makeCase(spec); } catch (e) { warn(`${label}: fixture not built: ${e.message}`); return; }
    try {
      const removed = await gc(c);
      const gone = !existsSync(c.sentinel);
      gone === shouldRemove && removed === (shouldRemove ? 1 : 0)
        ? pass(label)
        : fail(`${label}: expected ${shouldRemove ? 'reclaimed' : 'kept'}, got removed=${removed} gone=${gone}`);
    } catch (e) { fail(`${label}: gc threw ${e.message}`); }
  };

  await expectCase('fresh sentinel (1h, dead pid) kept', { pid: deadPid, ageHours: 1 }, false);
  await expectCase('stale + dead pid + no batch file reclaimed', { pid: deadPid, ageHours: 5 }, true);
  await expectCase('stale + dead pid + unrelated batch rows reclaimed',
    { pid: deadPid, ageHours: 5, batchRows: [['processing', '008'], ['completed', '009']] }, true);
  await expectCase('stale + LIVE pid kept', { pid: process.pid, ageHours: 5 }, false);
  // Load-bearing rule: PID is dead (the CLI exits right after reserving) but batch owns the number.
  await expectCase('stale + dead pid + batch row `processing` kept',
    { pid: deadPid, ageHours: 5, batchRows: [['processing', '007']] }, false);
  await expectCase('processing row with unpadded number (7) still claims 007',
    { pid: deadPid, ageHours: 5, batchRows: [['processing', '7']] }, false);
  await expectCase('stale + dead pid + batch row `completed` reclaimed',
    { pid: deadPid, ageHours: 5, batchRows: [['completed', '007']] }, true);
  await expectCase('stale + dead pid + batch row `failed` reclaimed',
    { pid: deadPid, ageHours: 5, batchRows: [['failed', '007']] }, true);
  await expectCase('odd batch rows (`-` / junk report_num) make no claim',
    { pid: deadPid, ageHours: 5, batchRows: [['processing', '-'], ['processing', 'abc']] }, true);

  // Entry points share the implementation and agree.
  try {
    const c = makeCase({ pid: deadPid, ageHours: 5, batchRows: [['processing', '007']] });
    const removed = await rr.gcStaleReportReservations({
      reportsDir: c.reports, trackerPath: c.tracker, batchStatePath: c.batchState,
    });
    removed === 0 && existsSync(c.sentinel)
      ? pass('reserve-report-num gcStaleReportReservations honours the batch claim')
      : fail(`reserve-report-num GC removed=${removed} exists=${existsSync(c.sentinel)}`);
    const w = await tu.gcStaleSentinels(c.reports, { trackerPath: c.tracker, batchStatePath: c.batchState, log: () => {} });
    w === 0 && existsSync(c.sentinel)
      ? pass('tracker-utils gcStaleSentinels wrapper honours the batch claim')
      : fail(`wrapper removed=${w} exists=${existsSync(c.sentinel)}`);
    // Control: the same wrapper reclaims once batch no longer claims it.
    writeFileSync(c.batchState, BATCH_HEADER + '1\tu\tcompleted\t-\t-\t007\t-\t-\t0\n');
    const w2 = await tu.gcStaleSentinels(c.reports, { trackerPath: c.tracker, batchStatePath: c.batchState, log: () => {} });
    w2 === 1 && !existsSync(c.sentinel)
      ? pass('CONTROL wrapper reclaims after batch row is completed')
      : fail(`CONTROL wrapper removed=${w2} exists=${existsSync(c.sentinel)}`);
  } catch (e) { fail(`entry-point agreement threw: ${e.message}`); }

  // JOBBER_BATCH_STATE override honoured end to end by verify-pipeline (Check 8).
  try {
    const c = makeCase({ pid: deadPid, ageHours: 5, batchRows: [['processing', '007']] });
    const env = { ...process.env, JOBBER_TRACKER: c.tracker, JOBBER_REPORTS: c.reports,
      JOBBER_BATCH_STATE: c.batchState };
    spawnSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], { env, encoding: 'utf-8', timeout: 60_000 });
    const kept = existsSync(c.sentinel);
    writeFileSync(c.batchState, BATCH_HEADER);
    spawnSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], { env, encoding: 'utf-8', timeout: 60_000 });
    kept && !existsSync(c.sentinel)
      ? pass('verify-pipeline Check 8: kept while batch row processing, reclaimed once cleared')
      : fail(`verify-pipeline: keptWhileProcessing=${kept} reclaimedAfterClear=${!existsSync(c.sentinel)}`);
  } catch (e) { warn(`verify-pipeline end-to-end not verified: ${e.message}`); }

  // The lock is taken: while another holder owns the tracker lock the GC must
  // wait (time out, sentinel untouched); once released it proceeds.
  let held = null;
  try {
    const c = makeCase({ pid: deadPid, ageHours: 5 });
    try {
      held = await tu.acquireTrackerLock(tu.trackerLockDirFor(tu.canonicalizeTrackerPath(c.tracker)), {
        timeoutMs: 2000, retryMs: 20, staleMs: 600_000,
      });
    } catch (e) { warn(`lock fixture not built, lock-taken check skipped: ${e.message}`); }
    if (held) {
      let err = null;
      try {
        await tu.gcStaleReportSentinels({
          reportsDir: c.reports, trackerPath: c.tracker, batchStatePath: c.batchState,
          lockOptions: { timeoutMs: 300, retryMs: 20 },
        });
      } catch (e) { err = e; }
      err?.code === 'LOCK_TIMEOUT' && existsSync(c.sentinel)
        ? pass('GC waits on the tracker lock (times out while held, sentinel untouched)')
        : fail(`GC did not respect the tracker lock: err=${err?.code ?? err?.message ?? 'none'} exists=${existsSync(c.sentinel)}`);
      held.release(); held = null;
      const removed = await gc(c);
      removed === 1 && !existsSync(c.sentinel)
        ? pass('CONTROL GC proceeds once the lock is released')
        : fail(`CONTROL GC after release removed=${removed} exists=${existsSync(c.sentinel)}`);
    }
  } catch (e) { fail(`lock check threw: ${e.message}`); }
  finally { try { held?.release(); } catch { /* ignore */ } }

  tu.SENTINEL_MAX_AGE_MS === 4 * 3600 * 1000
    ? pass('SENTINEL_MAX_AGE_MS is the one 4h constant (exported from tracker-utils)')
    : fail(`SENTINEL_MAX_AGE_MS = ${tu.SENTINEL_MAX_AGE_MS}`);
}
rmSync(work, { recursive: true, force: true });
