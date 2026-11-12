// tests/batch-state-lock.test.mjs — STATE-MACHINES-PLAN 5.4 (M22): batch-runner.sh's state lock
// (batch/.batch-state.lock) uses the same stale-recovery rules as lib/file-lock.mjs:
// owner pid decides when there is one (dead = recover, alive = never), directory age decides only
// when there is no owner, and reclaim is serialized behind a "<lock>.recover" guard directory.
// Runs the real batch-runner.sh against a throwaway project with a fake `claude` worker.
import { pass, fail, warn, ROOT, getBash, toBashPath } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync, copyFileSync, chmodSync, utimesSync } from 'fs';
import { join, delimiter } from 'path';
import { tmpdir } from 'os';
import { execFileSync, spawn, spawnSync } from 'child_process';

console.log('\nbatch-runner.sh state lock (5.4 / M22)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

const WORKER = [
  '#!/usr/bin/env bash',
  'mkdir -p "$PWD/reports"',
  'echo started >> "$PWD/batch/claude-invocations.txt"',
  'echo "# report" > "$PWD/reports/001-fixture.md"',
  'printf \'```json\\n{"status":"completed","score":4.0,"error":null}\\n```\\n\'',
  'exit 0',
].join('\n') + '\n';

function fixture() {
  const tmp = mkdtempSync(join(tmpdir(), 'co-batch-lock-'));
  try {
    const batchDir = join(tmp, 'batch');
    const fakeBin = join(tmp, 'bin');
    for (const d of [batchDir, fakeBin, join(tmp, 'reports'), join(tmp, 'data'), join(tmp, 'lib')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(batchDir, 'batch-runner.sh'), readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n'));
    writeFileSync(join(tmp, 'merge-tracker.mjs'), 'console.log("merge fixture");\n');
    writeFileSync(join(tmp, 'verify-pipeline.mjs'), 'console.log("verify fixture");\n');
    writeFileSync(join(tmp, 'reserve-report-num.mjs'), 'console.log("001");\n');
    copyFileSync(join(ROOT, 'lib/llm-providers.mjs'), join(tmp, 'lib', 'llm-providers.mjs'));
    writeFileSync(join(batchDir, 'batch-prompt.md'), 'URL={{URL}}\nREPORT={{REPORT_NUM}}\n');
    writeFileSync(join(batchDir, 'batch-input.tsv'), 'id\turl\tsource\tnotes\n1\thttps://example.com/one\tfixture\t-\n');
    writeFileSync(join(fakeBin, 'claude'), WORKER);
    try { chmodSync(join(fakeBin, 'claude'), 0o755); } catch { /* windows */ }
    if (process.platform === 'win32') {
      try { execFileSync(getBash(), ['-c', 'chmod +x bin/claude batch/batch-runner.sh'], { cwd: tmp }); } catch { /* best effort */ }
    }
    return { tmp, batchDir, lock: join(batchDir, '.batch-state.lock'), guard: join(batchDir, '.batch-state.lock.recover'), env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH}` } };
  } catch (e) {
    warn(`batch state-lock fixture could not be built: ${e.message}`);
    rmSync(tmp, { recursive: true, force: true });
    return null;
  }
}

function runner(fx) {
  const r = spawnSync(getBash(), [toBashPath(join(fx.batchDir, 'batch-runner.sh')), '--parallel', '1'], {
    cwd: fx.tmp, encoding: 'utf-8', timeout: 90000,
    env: { ...fx.env, STATE_LOCK_TIMEOUT_SECONDS: '3', STATE_LOCK_STALE_SECONDS: '30' },
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const backdate = (p, ms) => { const t = new Date(Date.now() - ms); utimesSync(p, t, t); };
const ranWorker = (fx) => existsSync(join(fx.batchDir, 'claude-invocations.txt'));

/** Run one scenario in its own fixture; `setup(fx)` plants the lock state. */
function scenario(setup) {
  const fx = fixture();
  if (!fx) return null;
  try {
    setup(fx);
    return { fx, r: runner(fx), lockLeft: existsSync(fx.lock), guardLeft: existsSync(fx.guard), worker: ranWorker(fx) };
  } finally { rmSync(fx.tmp, { recursive: true, force: true }); }
}
const recovered = (s) => /Recovered stale state lock/.test(s.r.out);
const timedOut = (s) => /Timed out waiting for state lock/.test(s.r.out);

// 1. owner pid is dead -> recovered (the pre-existing rule, kept).
{
  const s = scenario((fx) => { mkdirSync(fx.lock); writeFileSync(join(fx.lock, 'pid'), '999999\n'); });
  if (s) eq('dead owner pid: lock is recovered and the run completes', [recovered(s), s.worker, s.r.status], [true, true, 0]);
}

// 2. no owner at all, older than the stale age -> recovered (NEW: used to wait out the timeout forever).
{
  const s = scenario((fx) => { mkdirSync(fx.lock); backdate(fx.lock, 120_000); });
  if (s) eq('ownerless lock past the stale age: recovered and the run completes', [recovered(s), s.worker, s.r.status], [true, true, 0]);
}

// 3. control for 2: ownerless but fresh -> NOT stolen (acquisition window of a live winner).
{
  const s = scenario((fx) => { mkdirSync(fx.lock); });
  if (s) eq('control: fresh ownerless lock is respected (timeout, lock kept, no worker)', [timedOut(s), recovered(s), s.lockLeft, s.worker], [true, false, true, false]);
}

// 4. control for 1: owner pid alive -> never recovered, however old the directory is.
{
  const holder = spawn(getBash(), ['-c', 'echo $$; exec sleep 60'], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const pid = await new Promise((res) => { holder.stdout.once('data', (d) => res(String(d).trim())); });
    const s = scenario((fx) => { mkdirSync(fx.lock); writeFileSync(join(fx.lock, 'pid'), `${pid}\n`); backdate(fx.lock, 600_000); });
    if (s) eq('control: live owner pid is respected even when the lock is old (timeout, lock kept)', [timedOut(s), recovered(s), s.lockLeft, s.worker], [true, false, true, false]);
  } finally { holder.kill(); }
}

// 5. recover guard: an abandoned (old) guard does not disable recovery; a fresh one serializes it.
{
  const s = scenario((fx) => { mkdirSync(fx.lock); writeFileSync(join(fx.lock, 'pid'), '999999\n'); mkdirSync(fx.guard); backdate(fx.guard, 120_000); });
  if (s) eq('abandoned recover guard is cleared and the dead lock is recovered', [recovered(s), s.guardLeft, s.worker, s.r.status], [true, false, true, 0]);
  const c = scenario((fx) => { mkdirSync(fx.lock); writeFileSync(join(fx.lock, 'pid'), '999999\n'); mkdirSync(fx.guard); });
  if (c) eq('control: a fresh recover guard blocks recovery (timeout, lock kept)', [timedOut(c), recovered(c), c.lockLeft, c.worker], [true, false, true, false]);
}
