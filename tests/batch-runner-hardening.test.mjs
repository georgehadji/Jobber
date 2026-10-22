// tests/batch-runner-hardening.test.mjs — Workstream I of docs/AUDIT-FIX-PLAN.md.
// Runs the real batch/batch-runner.sh against a throwaway project with a fake `claude` worker:
//   - the worker's score survives an empty "error" field (it was always lost, so --min-score was dead)
//   - a URL containing "&" reaches the worker prompt unchanged (sed back-reference)
//   - --status does not delete the lock of a live runner
//   - no reserved report number means no worker is started
//   - a failed offer makes the runner exit non-zero
import { pass, fail, warn, ROOT, runAnyExit, getBash, toBashPath } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync, copyFileSync, chmodSync } from 'fs';
import { join, delimiter } from 'path';
import { tmpdir } from 'os';
import { execFileSync, spawnSync } from 'child_process';

console.log('\nbatch-runner.sh (audit workstream I)');

function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass(label);
  else fail(`${label}: got ${g}, want ${w}`);
}

const FAKE_WORKER = (jsonBlock) => [
  '#!/usr/bin/env bash',
  'mkdir -p "$PWD/reports"',
  'echo started >> "$PWD/batch/claude-invocations.txt"',
  'echo "# report" > "$PWD/reports/001-fixture.md"',
  'while [[ $# -gt 0 ]]; do',
  '  if [[ "$1" == "--append-system-prompt-file" ]]; then cp "$2" "$PWD/batch/prompt-seen.md"; fi',
  '  shift',
  'done',
  'printf \'```json\\n%s\\n```\\n\' \'' + jsonBlock + '\'',
  'exit 0',
].join('\n') + '\n';

/** Build a throwaway project; returns null (after warn) when it cannot be built. */
function fixture({ worker, reserve = 'console.log("001");', url = 'https://example.com/one' }) {
  const tmp = mkdtempSync(join(tmpdir(), 'co-batch-hard-'));
  try {
    const batchDir = join(tmp, 'batch');
    const fakeBin = join(tmp, 'bin');
    for (const d of [batchDir, fakeBin, join(tmp, 'reports'), join(tmp, 'data'), join(tmp, 'lib')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(batchDir, 'batch-runner.sh'), readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n'));
    writeFileSync(join(tmp, 'merge-tracker.mjs'), 'console.log("merge fixture");\n');
    writeFileSync(join(tmp, 'verify-pipeline.mjs'), 'console.log("verify fixture");\n');
    writeFileSync(join(tmp, 'reserve-report-num.mjs'), reserve + '\n');
    copyFileSync(join(ROOT, 'lib/llm-providers.mjs'), join(tmp, 'lib', 'llm-providers.mjs'));
    writeFileSync(join(batchDir, 'batch-prompt.md'), 'URL={{URL}}\nREPORT={{REPORT_NUM}}\n');
    writeFileSync(join(batchDir, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${url}\tfixture\t-\n`);
    writeFileSync(join(fakeBin, 'claude'), worker);
    try { chmodSync(join(fakeBin, 'claude'), 0o755); } catch { /* windows */ }
    if (process.platform === 'win32') {
      try { execFileSync(getBash(), ['-c', 'chmod +x bin/claude batch/batch-runner.sh'], { cwd: tmp }); } catch { /* best effort */ }
    }
    return { tmp, batchDir, fakeBin, env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH}` } };
  } catch (e) {
    warn(`batch fixture could not be built: ${e.message}`);
    rmSync(tmp, { recursive: true, force: true });
    return null;
  }
}

function runner(fx, args = []) {
  const r = spawnSync(getBash(), [toBashPath(join(fx.batchDir, 'batch-runner.sh')), '--parallel', '1', ...args], { cwd: fx.tmp, env: fx.env, encoding: 'utf-8', timeout: 90000 });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const stateRow = (fx) => (readFileSync(join(fx.batchDir, 'batch-state.tsv'), 'utf-8').trim().split('\n')[1] || '').split('\t');

// ── score survives an empty error field (N32) ────────────────────────────
{
  const okJson = '{"status":"completed","score":4.2,"error":null}';
  const fx = fixture({ worker: FAKE_WORKER(okJson) });
  if (fx) {
    const r = runner(fx, ['--min-score', '4.5']);
    const row = stateRow(fx);
    eq('score 4.2 with --min-score 4.5: the offer is skipped, not completed', [row[2], row[6], row[7]], ['skipped', '4.2', 'below-min-score']);
    eq('control: that run is healthy (skipped is not a failure) and exits 0', r.status, 0);
    rmSync(fx.tmp, { recursive: true, force: true });
  }
  const fx2 = fixture({ worker: FAKE_WORKER(okJson) });
  if (fx2) {
    runner(fx2, ['--min-score', '3.0']);
    const row = stateRow(fx2);
    eq('control: score 4.2 with --min-score 3.0 completes with the score recorded', [row[2], row[6]], ['completed', '4.2']);
    rmSync(fx2.tmp, { recursive: true, force: true });
  }
}

// ── "&" in a URL reaches the prompt unchanged (N33) ──────────────────────
{
  const url = 'https://example.com/jobs?a=1&b=2&ref=x';
  const fx = fixture({ worker: FAKE_WORKER('{"status":"completed","score":4.0,"error":null}'), url });
  if (fx) {
    runner(fx);
    const seen = existsSync(join(fx.batchDir, 'prompt-seen.md')) ? readFileSync(join(fx.batchDir, 'prompt-seen.md'), 'utf-8') : '';
    eq('the URL line of the resolved prompt is the exact URL', seen.split('\n').find((l) => l.startsWith('URL=')), `URL=${url}`);
    rmSync(fx.tmp, { recursive: true, force: true });
  }
  const fx2 = fixture({ worker: FAKE_WORKER('{"status":"completed","score":4.0,"error":null}'), url: 'https://example.com/plain' });
  if (fx2) {
    runner(fx2);
    const seen = existsSync(join(fx2.batchDir, 'prompt-seen.md')) ? readFileSync(join(fx2.batchDir, 'prompt-seen.md'), 'utf-8') : '';
    eq('control: a URL without "&" is unchanged too', seen.split('\n').find((l) => l.startsWith('URL=')), 'URL=https://example.com/plain');
    rmSync(fx2.tmp, { recursive: true, force: true });
  }
}

// ── a failed reservation starts no worker (N35) ──────────────────────────
{
  const fx = fixture({ worker: FAKE_WORKER('{"status":"completed","score":4.0,"error":null}'), reserve: 'console.log("WARN: lock busy");' });
  if (fx) {
    const r = runner(fx);
    const row = stateRow(fx);
    eq('no valid report number: the offer is failed with that reason', [row[2], row[7]], ['failed', 'could not reserve a report number']);
    eq('no valid report number: the worker was never started', existsSync(join(fx.batchDir, 'claude-invocations.txt')), false);
    eq('and the runner exits non-zero (a failed offer)', r.status, 1);
    rmSync(fx.tmp, { recursive: true, force: true });
  }
}

// ── --status leaves a live runner's lock alone (N34) ─────────────────────
{
  const fx = fixture({ worker: FAKE_WORKER('{"status":"completed","score":4.0,"error":null}') });
  if (fx) {
    writeFileSync(join(fx.batchDir, 'batch-state.tsv'), 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n');
    // One bash session: start a live process, point the lock at it, run --status, report whether the lock survived.
    const script = [
      'sleep 60 & LIVE=$!',
      'echo "$LIVE" > batch/batch-runner.pid',
      'bash batch/batch-runner.sh --status >/dev/null 2>&1',
      'if [[ -f batch/batch-runner.pid ]]; then echo LOCK_KEPT; else echo LOCK_DELETED; fi',
      'kill "$LIVE" 2>/dev/null',
    ].join('\n');
    const out = runAnyExit(getBash(), ['-c', script], { cwd: fx.tmp, env: fx.env });
    eq('--status does not delete the lock of a live runner', out.split('\n').pop(), 'LOCK_KEPT');
    rmSync(fx.tmp, { recursive: true, force: true });
  }
  const fx2 = fixture({ worker: FAKE_WORKER('{"status":"completed","score":4.0,"error":null}') });
  if (fx2) {
    runner(fx2);
    eq('control: a normal run removes its own lock when it ends', existsSync(join(fx2.batchDir, 'batch-runner.pid')), false);
    rmSync(fx2.tmp, { recursive: true, force: true });
  }
}
