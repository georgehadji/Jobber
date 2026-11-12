/**
 * tracker-writer-transaction-lock.test.mjs — tracker.mjs's removeRowByNum()
 * row-deletion contract, plus a structural guard that every root tracker
 * writer (and the Go dashboard's mirror) keeps its read and atomic
 * replacement inside one shared transaction/lock scope.
 *
 * Extracted verbatim from test-all.mjs.
 */

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { join } from 'path';
import { pass, fail, warn, ROOT } from './helpers.mjs';

function readFile(path) {
  return readFileSync(join(ROOT, path), 'utf-8');
}

// tracker.mjs delete: removeRowByNum removes the right row, preserves the rest.
try {
  const { removeRowByNum } = await import(pathToFileURL(join(ROOT, 'tracker.mjs')).href);
  const md = [
    '# Applications',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-06-01 | Acme | Dev | 4.0/5 | Evaluated | y | [r1](reports/1.md) | a |',
    '| 2 | 2026-06-02 | Beta | Eng | 3.5/5 | Applied | y | [r2](reports/2.md) | b |',
    '| 3 | 2026-06-03 | Gamma | Lead | 4.5/5 | Interview | y | [r3](reports/3.md) | c |',
    '',
  ].join('\n');
  const r2 = removeRowByNum(md, 2);
  const miss = removeRowByNum(md, 99);
  const ok =
    r2.removed && r2.removedCount === 1 &&
    r2.report === '[r2](reports/2.md)' &&            // report column (index 7) surfaced for orphan note
    !r2.newContent.includes('| 2 |') &&              // the target row is gone
    r2.newContent.includes('| 1 |') && r2.newContent.includes('| 3 |') && // other rows kept
    r2.newContent.includes('# Applications') &&      // non-table line preserved
    r2.newContent.includes('|---|') &&               // separator preserved
    miss.removed === false && miss.newContent === md; // no-op on a missing number
  if (ok) pass('tracker.mjs removeRowByNum: removes the matching row, preserves header/separator/other rows, no-op on miss');
  else fail('tracker.mjs removeRowByNum behaves wrong');
} catch (e) {
  fail(`tracker.mjs removeRowByNum test crashed: ${e.message}`);
}

// Every applications.md writer must perform its read and atomic replacement
// through one shared transaction object. The integration suite proves actual
// contention; these structural checks enforce the transaction boundaries.
try {
  const nodeTrackerWriters = [
    ['dedup-tracker.mjs', 1],
    ['normalize-statuses.mjs', 1],
    ['reply-watch.mjs', 1],
    ['tracker.mjs', 2],
  ];
  const unsafeWriters = nodeTrackerWriters.filter(([name, minTransactions]) => {
    const source = readFile(name);
    const opens = (source.match(/await\s+openTrackerTransaction\s*\(/g) || []).length;
    const reads = (source.match(/trackerTransaction\.read\s*\(/g) || []).length;
    const replacements = (source.match(/trackerTransaction\.replace\s*\(/g) || []).length;
    const closes = (source.match(/trackerTransaction\??\.close\s*\(/g) || []).length;
    return opens < minTransactions || reads < 1 || replacements < minTransactions || closes < minTransactions
      || source.includes('acquireTrackerLock') || source.includes('trackerLockDirFor')
      || /writeFileAtomic\(\s*(?:APPS_FILE|MD_PATH|trackerPath|writeTarget)\b/.test(source)
      || /(?:fs\.)?writeFileSync\(\s*(?:APPS_FILE|MD_PATH|trackerPath)\b/.test(source);
  }).map(([name]) => name);
  if (unsafeWriters.length === 0) {
    pass('all root tracker writers keep read and atomic replacement in shared transactions');
  } else {
    fail(`tracker writers bypass shared transaction scope: ${unsafeWriters.join(', ')}`);
  }

  // The Go dashboard no longer writes the tracker itself (STATE-MACHINES-PLAN 4.2 follow-up):
  // every status change shells out to set-status.mjs, which holds the shared lock. Absence check,
  // so a static scan is acceptable; a determined rewrite can still evade it.
  const goWriterMarkers = (src) => ['func UpdateApplicationStatus', 'acquireTrackerLock(', 'writeFileAtomic(', 'replaceFileAtomic(']
    .filter(m => src.includes(m));
  const goFiles = execFileSync('git', ['ls-files', 'dashboard/**/*.go'], { cwd: ROOT, encoding: 'utf-8' })
    .split(String.fromCharCode(10)).filter(f => f && !f.endsWith('_test.go'));
  const offenders = goFiles.flatMap(f => goWriterMarkers(readFile(f)).map(m => `${f}: ${m}`));
  // control: the checker really does flag a direct writer
  const controlHit = goWriterMarkers('func UpdateApplicationStatus(x) { acquireTrackerLock(p) }');
  if (controlHit.length !== 2) fail(`dashboard writer control did not flag the markers (got ${JSON.stringify(controlHit)})`);
  else if (goFiles.length === 0) warn('no dashboard Go files found: dashboard writer check not verified');
  else if (offenders.length > 0) fail(`dashboard has a direct tracker writer again: ${offenders.join('; ')}`);
  else if (!/set-status.mjs/.test(readFile('dashboard/internal/data/setstatus.go'))) fail('dashboard setstatus.go does not call set-status.mjs');
  else pass('dashboard has no direct tracker writer; status changes go through set-status.mjs');
} catch (e) {
  fail(`tracker writer lock contract tests crashed: ${e.message}`);
}
