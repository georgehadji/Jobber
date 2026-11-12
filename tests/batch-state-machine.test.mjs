// tests/batch-state-machine.test.mjs — STATE-MACHINES-PLAN Phase 4.3 (M6): the batch-job machine.
// Exercises the real batch/batch-runner.sh in a throwaway project:
//   - the generated state tables in the runner match templates/machines/batch-job.yml (+ stale control)
//   - update_state accepts every legal state, rejects a bogus one with the legal list
//   - an undeclared transition only WARNS (warn-first), a declared one is silent
//   - the summary counts every state, rate_limited on its own
//   - a row left in processing / rate_limited / paused_rate_limit reuses its held report number
import { pass, fail, warn, ROOT, NODE, getBash, toBashPath } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync, chmodSync, copyFileSync } from 'fs';
import { join, delimiter } from 'path';
import { tmpdir } from 'os';
import { spawnSync, execFileSync } from 'child_process';
import { loadMachine } from '../lib/state-machine.mjs';
import { renderBlock, applyBlock } from '../batch/gen-states.mjs';

console.log('\nbatch-job state machine (Phase 4.3)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const machine = loadMachine('batch-job');
const STATES = machine.states.map(s => s.id);
const RUNNER_SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');
const HEADER = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries';

// ── generated block vs yml ────────────────────────────────────────────────
{
  const fresh = applyBlock(RUNNER_SRC, renderBlock(machine));
  eq('the runner carries the markers and its generated block equals a fresh render of batch-job.yml', [fresh.found, fresh.text === RUNNER_SRC], [true, true]);
  // control: drop one declared edge from the yml-derived machine, so the committed block must look stale
  const edited = { ...machine, transitions: { ...machine.transitions, failed: [] } };
  const stale = applyBlock(RUNNER_SRC, renderBlock(edited));
  eq('control: a machine with one edge removed renders a DIFFERENT block (stale runner is detected)', stale.text !== RUNNER_SRC, true);
  const noMarkers = applyBlock('echo hi\n', renderBlock(machine));
  eq('control: a script without markers is reported as not found, never silently skipped', noMarkers.found, false);
  const cli = spawnSync(NODE, [join(ROOT, 'batch/gen-states.mjs'), '--check'], { encoding: 'utf-8' });
  eq('gen-states.mjs --check exits 0 on the committed runner', [cli.status, cli.stderr], [0, '']);
}

// ── sandbox ───────────────────────────────────────────────────────────────
const FAKE_WORKER = [
  '#!/usr/bin/env bash',
  'num=$(printf "%s" "${*: -1}" | sed -n "s/.*Report number: \\([0-9]*\\).*/\\1/p")',
  'mkdir -p "$PWD/reports"',
  'echo "# report" > "$PWD/reports/${num}-fixture.md"',
  'printf \'```json\\n{"status":"completed","score":4.2,"error":null}\\n```\\n\'',
  'exit 0',
].join('\n') + '\n';
// counts fresh reservations ("calls") apart from releases; always hands out 020
const FAKE_RESERVE = [
  "import { appendFileSync } from 'fs';",
  "const f = process.argv[2] === '--release' ? 'releases.txt' : 'reserve-calls.txt';",
  "appendFileSync(new URL('./' + f, import.meta.url), 'x');",
  "if (process.argv[2] !== '--release') console.log('020');",
].join('\n') + '\n';

function sandbox() {
  const tmp = mkdtempSync(join(tmpdir(), 'co-batch-sm-'));
  try {
    const batchDir = join(tmp, 'batch');
    const fakeBin = join(tmp, 'bin');
    for (const d of [batchDir, fakeBin, join(tmp, 'reports'), join(tmp, 'data'), join(tmp, 'lib')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(batchDir, 'batch-runner.sh'), RUNNER_SRC);
    writeFileSync(join(tmp, 'merge-tracker.mjs'), 'console.log("merge fixture");\n');
    writeFileSync(join(tmp, 'verify-pipeline.mjs'), 'console.log("verify fixture");\n');
    writeFileSync(join(tmp, 'reconcile-pipeline.mjs'), 'console.log("reconcile fixture");\n');
    writeFileSync(join(tmp, 'reserve-report-num.mjs'), FAKE_RESERVE);
    copyFileSync(join(ROOT, 'lib/llm-providers.mjs'), join(tmp, 'lib', 'llm-providers.mjs'));
    writeFileSync(join(batchDir, 'batch-prompt.md'), 'URL={{URL}}\nREPORT={{REPORT_NUM}}\n');
    writeFileSync(join(fakeBin, 'claude'), FAKE_WORKER);
    try { chmodSync(join(fakeBin, 'claude'), 0o755); } catch { /* windows */ }
    if (process.platform === 'win32') {
      try { execFileSync(getBash(), ['-c', 'chmod +x bin/claude batch/batch-runner.sh'], { cwd: tmp }); } catch { /* best effort */ }
    }
    return { tmp, batchDir, env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH}` } };
  } catch (e) {
    warn(`batch-state-machine sandbox could not be built: ${e.message}`);
    rmSync(tmp, { recursive: true, force: true });
    return null;
  }
}

/** Source the runner (main does not run when sourced) and execute `script`. */
function inRunner(sb, script) {
  const r = spawnSync(getBash(), ['-c', `f="$1"; set --; source "$f"; ${script}`, 'bash', toBashPath(join(sb.batchDir, 'batch-runner.sh'))], { cwd: sb.tmp, env: sb.env, encoding: 'utf-8', timeout: 90000 });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const rows = sb => readFileSync(join(sb.batchDir, 'batch-state.tsv'), 'utf-8').trim().split('\n').slice(1).map(l => l.split('\t'));

// ── update_state: every legal state accepted, bogus rejected ─────────────
{
  const sb = sandbox();
  if (sb) {
    try {
      const loop = `init_state; n=0; for s in $BATCH_STATES; do n=$((n+1)); if update_state "$n" "http://x/$n" "$s" - - 001 - - 0; then echo "OK $s"; else echo "REJECT $s"; fi; done`;
      const r = inRunner(sb, loop);
      eq('every state declared in the yml is accepted by update_state', r.out.trim().split('\n'), STATES.map(s => `OK ${s}`));
      eq('...and each is stored as written in the state file', rows(sb).map(c => c[2]), STATES);

      const before = readFileSync(join(sb.batchDir, 'batch-state.tsv'), 'utf-8');
      const bad = inRunner(sb, 'update_state 99 http://x/99 bogus - - 001 - - 0 || echo "rc=$?"');
      eq('a bogus state makes update_state return non-zero', /rc=1/.test(bad.out), true);
      const named = /unknown state "bogus"/.test(bad.err);
      const listsAll = STATES.every(s => bad.err.includes(s));
      eq('the error names the bad value and lists every legal state', [named, listsAll], [true, true]);
      eq('the state file is untouched by the rejected write', readFileSync(join(sb.batchDir, 'batch-state.tsv'), 'utf-8'), before);
      eq('control: the lock is released after a rejection (a following legal write works)', inRunner(sb, 'update_state 7 http://x/7 failed - - 001 - - 0; echo "rc=$?"').out.includes('rc=0'), true);
    } finally { rmSync(sb.tmp, { recursive: true, force: true }); }
  }
}

// ── transitions are warn-only ────────────────────────────────────────────
{
  const sb = sandbox();
  if (sb) {
    try {
      writeFileSync(join(sb.batchDir, 'batch-state.tsv'), `${HEADER}\n1\thttp://x/1\tcompleted\t-\t-\t001\t4.0\t-\t0\n2\thttp://x/2\tprocessing\t-\t-\t002\t-\t-\t0\n`);
      const illegal = inRunner(sb, 'update_state 1 http://x/1 processing - - 001 - - 0; echo "rc=$?"');
      eq('completed -> processing (terminal exit) warns and still writes (rc 0)', [/undeclared transition completed -> processing/.test(illegal.err), illegal.out.includes('rc=0'), rows(sb)[0][2]], [true, true, 'processing']);
      const legal = inRunner(sb, 'update_state 2 http://x/2 completed - - 002 4.0 - 0; echo "rc=$?"');
      eq('control: processing -> completed (declared) is silent', [legal.err.includes('WARN'), rows(sb)[1][2]], [false, 'completed']);
      const fresh = inRunner(sb, 'update_state 3 http://x/3 completed - - 003 4.0 - 0; echo "rc=$?"');
      eq('a brand-new row is judged from pending: pending -> completed warns', /undeclared transition pending -> completed/.test(fresh.err), true);
    } finally { rmSync(sb.tmp, { recursive: true, force: true }); }
  }
}

// ── summary counts every state ───────────────────────────────────────────
{
  const sb = sandbox();
  if (sb) {
    try {
      const extra = ['rate_limited', 'pending'];
      const lines = [...STATES, ...extra].map((s, i) => `${i + 1}\thttp://x/${i + 1}\t${s}\t-\t-\t00${i + 1}\t${s === 'completed' ? '4.0' : '-'}\t-\t0`);
      writeFileSync(join(sb.batchDir, 'batch-state.tsv'), `${HEADER}\n${lines.join('\n')}\n`);
      const r = inRunner(sb, 'print_summary');
      const line = r.out.split('\n').find(l => l.startsWith('Total:')) || '';
      eq('the summary line gives each of the 7 states (plus a second rate_limited and a second pending) its own count',
        line, 'Total: 9 | Completed: 1 | Skipped: 1 | Failed: 1 | Pending: 2 | Processing: 1 | Rate Limited: 2 | Paused: 1');
      eq('control: rate_limited is no longer folded into Pending (Pending is exactly the 2 pending rows)', /Pending: 2 /.test(line), true);
    } finally { rmSync(sb.tmp, { recursive: true, force: true }); }
  }
}

// ── held report number is reused ─────────────────────────────────────────
function runnerCase({ status, args = [], sentinel = true, existingReport = false }) {
  const sb = sandbox();
  if (!sb) return null;
  try {
    writeFileSync(join(sb.batchDir, 'batch-input.tsv'), 'id\turl\tsource\tnotes\n1\thttp://x/1\tfixture\t-\n');
    writeFileSync(join(sb.batchDir, 'batch-state.tsv'), `${HEADER}\n1\thttp://x/1\t${status}\t2026-01-01T00:00:00Z\t-\t005\t-\t-\t0\n`);
    if (sentinel) writeFileSync(join(sb.tmp, 'reports', '005-RESERVED.md'), '{}');
    if (existingReport) writeFileSync(join(sb.tmp, 'reports', '005-other.md'), '# someone else');
    const r = spawnSync(getBash(), [toBashPath(join(sb.batchDir, 'batch-runner.sh')), '--parallel', '1', ...args], { cwd: sb.tmp, env: sb.env, encoding: 'utf-8', timeout: 90000 });
    const calls = existsSync(join(sb.tmp, 'reserve-calls.txt')) ? readFileSync(join(sb.tmp, 'reserve-calls.txt'), 'utf-8').length : 0;
    return { exit: r.status, calls, row: rows(sb)[0], out: `${r.stdout || ''}${r.stderr || ''}`, reports: existsSync(join(sb.tmp, 'reports', '005-fixture.md')), fresh: existsSync(join(sb.tmp, 'reports', '020-fixture.md')) };
  } finally { rmSync(sb.tmp, { recursive: true, force: true }); }
}

for (const [status, args] of [['processing', []], ['rate_limited', []], ['paused_rate_limit', ['--resume-paused']]]) {
  const r = runnerCase({ status, args });
  if (!r) continue;
  eq(`a ${status} row with its sentinel still held reuses report 005: no new reservation, completed under 005`,
    [r.calls, r.row[2], r.row[5], r.reports, r.fresh], [0, 'completed', '005', true, false]);
}
{
  // controls: same crashed row, but the number is NOT safely reusable -> today's behaviour (fresh number)
  const noSentinel = runnerCase({ status: 'processing', sentinel: false });
  if (noSentinel) eq('control: processing row whose sentinel is gone reserves a fresh number (020)', [noSentinel.calls, noSentinel.row[5], noSentinel.fresh], [1, '020', true]);
  const taken = runnerCase({ status: 'processing', existingReport: true });
  if (taken) eq('control: number already claimed by a real report file is NOT reused (fresh 020)', [taken.calls, taken.row[5]], [1, '020']);
  const failed = runnerCase({ status: 'failed' });
  if (failed) eq('control: a failed row (number was released) reserves a fresh number', [failed.calls, failed.row[5]], [1, '020']);
}
