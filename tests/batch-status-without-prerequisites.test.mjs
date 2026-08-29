/**
 * batch-status-without-prerequisites.test.mjs — batch-runner.sh's --status
 * must read existing batch-state.tsv and report scores/errors even when
 * batch-input.tsv, batch-prompt.md, and the claude binary are all absent
 * (the full run prerequisites --status deliberately does not need).
 *
 * Split out of a too-slow-for-one-file batch cluster extracted verbatim
 * from test-all.mjs, kept to a single subprocess spawn so it comfortably
 * finishes under test-runner.mjs's per-file timeout under --parallel
 * contention (see tests/batch-url-rediscovery-misc.test.mjs).
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'fs';
import { join, delimiter } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pass, fail, ROOT, run, getBash, toBashPath } from './helpers.mjs';

console.log('\n13. Batch rate-limit pause (--status without prerequisites)');

try {
  const tmp = mkdtempSync(join(tmpdir(), 'co-batch-status-'));
  const batchDir = join(tmp, 'batch');
  const fakeBin = join(tmp, 'bin');
  mkdirSync(batchDir, { recursive: true });
  mkdirSync(join(tmp, 'reports'), { recursive: true });
  mkdirSync(join(tmp, 'data'), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  writeFileSync(join(batchDir, 'batch-runner.sh'), readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n'));
  if (process.platform === 'win32') {
    try { execFileSync(getBash(), ['-c', 'chmod +x batch/batch-runner.sh'], { cwd: tmp }); } catch {}
  } else {
    execFileSync('chmod', ['+x', join(batchDir, 'batch-runner.sh')]);
  }
  writeFileSync(join(tmp, 'merge-tracker.mjs'), 'console.log("merge fixture");\n');
  writeFileSync(join(tmp, 'verify-pipeline.mjs'), 'console.log("verify fixture");\n');
  mkdirSync(join(tmp, 'lib'), { recursive: true });
  copyFileSync(join(ROOT, 'lib/llm-providers.mjs'), join(tmp, 'lib', 'llm-providers.mjs'));

  // --status must work WITHOUT batch-input.tsv, batch-prompt.md, or a claude
  // binary on PATH — none of those are written here, unlike a full run.
  const env = { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH}` };
  writeFileSync(join(batchDir, 'batch-state.tsv'), [
    'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
    '1\thttps://example.com/one\tcompleted\t2026-01-01T00:00:00Z\t2026-01-01T00:00:01Z\t001\t4.5\t-\t0',
    '2\thttps://example.com/two\tcompleted\t2026-01-01T00:00:00Z\t2026-01-01T00:00:01Z\t002\tbad);system("oops")\t-\t0',
    '3\thttps://example.com/three\tskipped\t2026-01-01T00:00:00Z\t2026-01-01T00:00:01Z\t003\t3.5\tbelow-min-score\t0',
  ].join('\n') + '\n');
  const statusOnly = run(getBash(), [toBashPath(join(batchDir, 'batch-runner.sh')), '--status'], {
    cwd: tmp,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) || '';
  if (statusOnly.includes('Average score: 4.5/5 (1 scored)') && statusOnly.includes('bad);system("oops")')) {
    pass('--status reads existing state without full batch prerequisites');
  } else {
    fail(`--status prerequisite/score handling wrong: ${statusOnly}`);
  }

  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
} catch (e) {
  fail(`Batch --status test crashed: ${e.message}`);
}
