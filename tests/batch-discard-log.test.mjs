/**
 * batch-discard-log.test.mjs — batch-runner.sh's log_discard() helper must
 * append a one-line, auditable {timestamp, id, url, reason} record to
 * batch/logs/discard.log.
 *
 * Split out of a too-slow-for-one-file batch cluster extracted verbatim
 * from test-all.mjs, kept to a single subprocess spawn so it comfortably
 * finishes under test-runner.mjs's per-file timeout under --parallel
 * contention (see tests/batch-url-rediscovery-misc.test.mjs).
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT, run, getBash, toBashPath } from './helpers.mjs';

console.log('\n14b. Batch pre-screen discard log (log_discard helper)');

try {
  const tmp = mkdtempSync(join(tmpdir(), 'co-batch-discard-'));
  const batchDir = join(tmp, 'batch');
  mkdirSync(batchDir, { recursive: true });

  const runnerSrc = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');
  if (!runnerSrc.includes('log_discard()')) {
    fail('batch-runner.sh is missing the log_discard() helper required for the auditable discard log');
  } else {
    // Source only the function definitions (guard against `main "$@"` running)
    // by stripping the trailing invocation line, then call log_discard directly.
    const sourceable = runnerSrc.replace(/\nmain "\$@"\s*$/, '\n');
    writeFileSync(join(batchDir, 'batch-runner.lib.sh'), sourceable);
    const script = [
      'set -euo pipefail',
      `source "${toBashPath(join(batchDir, 'batch-runner.lib.sh'))}"`,
      'log_discard "7" "https://example.com/mismatch" "wrong seniority band"',
      `cat "${toBashPath(join(batchDir, 'logs', 'discard.log'))}"`,
    ].join('\n');
    const out = run(getBash(), ['-c', script], { cwd: tmp, stdio: ['pipe', 'pipe', 'pipe'] }) || '';
    const line = out.trim().split('\n').pop() || '';
    const cols = line.split('\t');

    if (
      cols.length === 4 &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(cols[0]) &&
      cols[1] === '7' &&
      cols[2] === 'https://example.com/mismatch' &&
      cols[3] === 'wrong seniority band'
    ) {
      pass('log_discard appends a one-line, auditable {timestamp, id, url, reason} record to batch/logs/discard.log');
    } else {
      fail(`log_discard output malformed: ${JSON.stringify(out)}`);
    }
  }

  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
} catch (e) {
  fail(`Batch pre-screen discard log test crashed: ${e.message}`);
}
