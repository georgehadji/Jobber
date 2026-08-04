#!/usr/bin/env node

/**
 * test-runner.mjs — discover and run tests/**\/*.test.mjs files individually.
 *
 * The full suite (test-all.mjs) concatenates every discovered test file into
 * one in-process import and shares a single counter set (tests/helpers.mjs).
 * That is the canonical, byte-identical path — this runner exists for the
 * OTHER needs test-all's monolith can't serve:
 *
 *   - Per-file attribution: which test file owns which pass/fail/warn?
 *   - Crash isolation: one throwing file no longer aborts the whole run.
 *   - Parallel execution: independent files can run on separate workers.
 *   - Faster CI triage: failures identify the file on the first line.
 *
 * COUNTER MODEL (why this is faithful to test-all):
 * Discovered files share the module-level counters in tests/helpers.mjs
 * (pass/fail/warn). The canonical total is therefore the SUM of every
 * file's assertions — and this runner reproduces exactly that sum, because
 * it uses the SAME in-process import mechanism test-all uses. A file that
 * prints its own "✅" lines (e.g. application-artifacts.test.mjs) does NOT
 * bump the shared counters and is NOT counted here — matching test-all.
 *
 * Usage:
 *   node test-runner.mjs                 # serial, in-process (golden parity)
 *   node test-runner.mjs --parallel 4    # 4 worker processes, faster
 *   node test-runner.mjs --quick         # forward --quick to each import
 *   node test-runner.mjs --only <substr> # only files whose path contains <substr>
 *   node test-runner.mjs --json          # machine-readable per-file results
 *   node test-runner.mjs --ci            # exit 1 on any failure (same as finish())
 *
 * --parallel mode: each file runs in its own child process (`node <file>`),
 * and the runner parses the shared-counter markers (✅/❌/⚠️) from the
 * process's stdout to attribute results per file. Files that call
 * process.exit() are refused (same guard as test-all #1916). Counts in
 * --parallel mode are authoritative for files that use pass()/fail()/warn()
 * only; files printing their own markers are counted as best-effort.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)));
const TESTS_DIR = join(ROOT, 'tests');
const NODE = process.execPath;

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const JSON_OUT = args.includes('--json');
const CI_MODE = args.includes('--ci');
const parallelIdx = args.indexOf('--parallel');
const PARALLEL = parallelIdx !== -1 ? Math.max(1, parseInt(args[parallelIdx + 1], 10) || 1) : 0;
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx !== -1 ? (args[onlyIdx + 1] ?? null) : null;

/** Recursive discovery — identical order to test-all.mjs (lexicographic). */
function discoverTests(dir) {
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...discoverTests(full));
    else if (entry.name.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

/**
 * The process.exit() guard — a discovered suite that exits itself would
 * terminate the runner mid-run. Same refusal as test-all (#1916).
 *
 * @param {string} file - Absolute path to a discovered test file.
 * @returns {boolean} True when the file is safe to run.
 */
function isSafeToRun(file) {
  if (!/\bprocess\.exit\s*\(/.test(readFileSync(file, 'utf-8'))) return true;
  console.log(`  ❌ ${file.slice(ROOT.length + 1)} calls process.exit() — discovered suites must use pass/fail from tests/helpers.mjs and never exit`);
  return false;
}

/**
 * Snapshot the shared counters before running a file, run it, then compute
 * the delta. This gives per-file attribution while keeping the exact
 * counter semantics of test-all.mjs.
 *
 * @returns {{passed: number, failed: number, warnings: number}}
 */
async function importCounts() {
  const { results } = await import(pathToFileURL(join(ROOT, 'tests', 'helpers.mjs')).href);
  return results();
}

/**
 * Serial mode: import each file in-process (identical to test-all),
 * snapshotting counters before/after for attribution. Crashes are caught
 * per-file so one throwing suite can't abort the rest.
 *
 * @param {string[]} files - Discovered test files.
 * @returns {Promise<Array<object>>} Per-file results.
 */
async function runSerial(files) {
  const out = [];
  for (const f of files) {
    if (!isSafeToRun(f)) {
      out.push({ file: f, passed: 0, failed: 1, warnings: 0, crashed: false, refused: true });
      continue;
    }
    const before = await importCounts();
    const started = Date.now();
    let crashed = false;
    try {
      await import(pathToFileURL(f).href);
    } catch (e) {
      crashed = true;
      console.log(`  ❌ ${f.slice(ROOT.length + 1)} crashed: ${e.message}`);
    }
    const after = await importCounts();
    out.push({
      file: f,
      passed: after.passed - before.passed,
      failed: after.failed - before.failed + (crashed ? 1 : 0),
      warnings: after.warnings - before.warnings,
      crashed,
      ms: Date.now() - started,
    });
  }
  return out;
}

/**
 * Parallel mode: run each file as its own child process and parse the
 * pass/fail/warn markers from stdout. Faster, but counts are best-effort
 * for files that print their own markers without pass()/fail().
 *
 * @param {string[]} files - Discovered test files.
 * @param {number} concurrency - Number of workers.
 * @returns {Promise<Array<object>>} Per-file results.
 */
async function runParallel(files, concurrency) {
  const out = new Array(files.length).fill(null);
  let next = 0;

  const worker = async () => {
    while (true) {
      const idx = next++;
      if (idx >= files.length) return;
      const f = files[idx];
      if (!isSafeToRun(f)) {
        out[idx] = { file: f, passed: 0, failed: 1, warnings: 0, crashed: false, refused: true, ms: 0 };
        continue;
      }
      const started = Date.now();
      let res;
      try {
        res = spawnSync(NODE, [f, ...(QUICK ? ['--quick'] : [])], {
          encoding: 'utf-8', timeout: 120_000, cwd: ROOT,
          env: { ...process.env, JOBBER_TEST_RUNNER: '1' },
        });
      } catch (e) {
        out[idx] = { file: f, passed: 0, failed: 1, warnings: 0, crashed: true, refused: false, ms: 0, error: e.message };
        continue;
      }
      const stdout = (res.stdout || '') + (res.stderr || '');
      // Count the shared-counter markers as they appear in child stdout.
      const passed = (stdout.match(/✅/g) || []).length;
      const failed = (stdout.match(/❌/g) || []).length;
      const warnings = (stdout.match(/⚠️/g) || []).length;
      // A crash (non-zero exit + no finish() line) still counts as failure.
      const crashed = res.status !== 0 && !/📊 Results:/m.test(stdout);
      if (crashed) {
        console.log(`  ❌ ${f.slice(ROOT.length + 1)} crashed (exit ${res.status})`);
      }
      out[idx] = { file: f, passed, failed: failed + (crashed ? 1 : 0), warnings, crashed, refused: false, ms: Date.now() - started };
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

// ── Main ────────────────────────────────────────────────────────
const files = discoverTests(TESTS_DIR);
const filtered = ONLY ? files.filter(f => f.slice(TESTS_DIR.length + 1).replace(/\\/g, '/').includes(ONLY)) : files;

if (filtered.length === 0) {
  console.log(`  ❌ no test files matched${ONLY ? ` --only "${ONLY}"` : ''} under tests/`);
  process.exit(1);
}

if (JSON_OUT) {
  // In --json mode, always run files as child processes so the test files'
  // own console output is captured per-file and never pollutes the JSON
  // stream on stdout. --parallel controls concurrency (default serial spawns).
  const results = await runParallel(filtered, PARALLEL > 0 ? PARALLEL : 1);
  const totals = results.reduce((a, r) => ({ passed: a.passed + r.passed, failed: a.failed + r.failed, warnings: a.warnings + r.warnings }), { passed: 0, failed: 0, warnings: 0 });
  console.log(JSON.stringify({ mode: PARALLEL > 0 ? 'parallel' : 'serial-spawn', files: results, totals }, null, 2));
  process.exit(totals.failed > 0 ? 1 : 0);
}

console.log(`\n🧪 Jobber test runner (${PARALLEL > 0 ? PARALLEL + 'x parallel' : 'serial in-process'})${ONLY ? ` --only ${ONLY}` : ''}\n`);

const results = PARALLEL > 0 ? await runParallel(filtered, PARALLEL) : await runSerial(filtered);

// Per-file summary (failures first so triage starts on the right line).
const totals = results.reduce((a, r) => ({ passed: a.passed + r.passed, failed: a.failed + r.failed, warnings: a.warnings + r.warnings }), { passed: 0, failed: 0, warnings: 0 });
console.log('\n── Per-file results ──');
for (const r of [...results].sort((a, b) => b.failed - a.failed || a.file.localeCompare(b.file))) {
  const rel = r.file.slice(ROOT.length + 1).replace(/\\/g, '/');
  const tag = r.crashed ? '💥' : r.failed > 0 ? '❌' : '✅';
  console.log(`  ${tag} ${rel} — ${r.passed} passed, ${r.failed} failed, ${r.warnings} warnings${r.ms ? ` (${r.ms}ms)` : ''}`);
}

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${totals.passed} passed, ${totals.failed} failed, ${totals.warnings} warnings`);
if (totals.failed > 0) {
  console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
  process.exit(1);
} else if (totals.warnings > 0) {
  console.log('🟡 Tests passed with warnings — review before pushing\n');
  process.exit(0);
} else {
  console.log('🟢 All tests passed — safe to push/merge\n');
  process.exit(0);
}
