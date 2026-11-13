// tests/provider-health.test.mjs — regression coverage for provider-health.mjs.
//
// The canary itself hits live public APIs (network), so unit tests target the
// exported classification path with a mocked fetch. We can't easily mock
// global fetch without importing the module (its top-level runs probes), so
// these tests exercise the script as a CLI with --no-cache against real APIs
// only when the network allows, and assert the JSON contract + exit codes that
// don't need the network (cache, --ci exit semantics on empty results).
//
// Network-free assertions:
//   - --json emits valid JSON with a `results` array of {provider, status}
//   - a second run within the cache window says cached: true (cache is SEEDED, not taken from the live probe)
//   - --ci exits 0 on an all-healthy cache, 1 when a canary is down, 0 when only degraded/skipped
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nprovider-health.mjs — contract');

// Point the cache at a temp file via JOBBER_HEALTH_CACHE (the portable
// override — os.tmpdir() ignores TMPDIR on Windows, so an env var is the only
// reliable isolation). The real user cache is never touched by tests.
const TMP = mkdtempSync(join(tmpdir(), 'jobber-health-test-'));
const CACHE = join(TMP, 'health-cache.json');
const env = { ...process.env, JOBBER_HEALTH_CACHE: CACHE };

const run = (args) => execFileSync(NODE, [join(ROOT, 'provider-health.mjs'), '--no-cache', ...args], {
  encoding: 'utf-8',
  timeout: 60_000,
  env,
});

try {
  // --- JSON contract ---
  try {
    const jsonOut = run(['--json']);
    const parsed = JSON.parse(jsonOut);
    const hasResults = Array.isArray(parsed.results) && parsed.results.length > 0;
    const allHaveShape = parsed.results.every(r =>
      typeof r.provider === 'string' && typeof r.status === 'string' && typeof r.latencyMs === 'number');
    if (hasResults && allHaveShape) {
      pass('--json emits { cached, results[] } with provider/status/latencyMs shape');
    } else {
      fail(`--json output has unexpected shape: ${jsonOut.slice(0, 200)}`);
    }
    // Known providers are present (the canary set is a fixed contract).
    const ids = parsed.results.map(r => r.provider);
    for (const id of ['greenhouse', 'lever', 'ashby', 'workday', 'bamboohr']) {
      if (!ids.includes(id)) fail(`provider-health --json missing canary ${id}`);
    }
    pass('canary set covers greenhouse/lever/ashby/workday/bamboohr');
  } catch (e) {
    fail(`provider-health --json failed: ${e.message}`);
  }

  // --- Cache + --ci exit code, with a SEEDED cache ---
  // The live --no-cache run above writes whatever the network looked like at that moment (a slow or down
  // ATS endpoint is a legitimate result) into the cache. Asserting --ci off that cache made the test fail
  // whenever one canary was down. So the cache is overwritten with a known set before these checks: the
  // assertions are about the cache path and the exit-code rule, not about the vendors' uptime.
  const canaryIds = ['greenhouse', 'lever', 'ashby', 'workday', 'bamboohr'];
  const seed = (statuses) => writeFileSync(CACHE, JSON.stringify({
    ts: Date.now(),
    results: canaryIds.map((id, i) => ({ provider: id, name: id, status: statuses[i], latencyMs: statuses[i] === 'skipped' ? 0 : 5 })),
  }));
  const cli = (args) => spawnSync(NODE, [join(ROOT, 'provider-health.mjs'), ...args], { encoding: 'utf-8', timeout: 60_000, env });

  try {
    seed(['healthy', 'healthy', 'healthy', 'healthy', 'skipped']);
    const second = cli(['--json']);
    const parsed = JSON.parse(second.stdout);
    if (parsed.cached === true) {
      pass('cached run reports cached: true (no network re-probe)');
    } else {
      fail('second --json run expected cached: true');
    }
  } catch (e) {
    fail(`cache assertion failed: ${e.message}`);
  }

  try {
    seed(['healthy', 'healthy', 'healthy', 'healthy', 'skipped']);
    const ok = cli(['--ci']);
    if (ok.status === 0) pass('--ci exits 0 with a cached all-healthy run');
    else fail(`--ci exited ${ok.status} on a seeded healthy cache: ${(ok.stdout + ok.stderr).slice(0, 200)}`);

    // control: the same command on a cache holding one DOWN canary exits 1, so the exit-0 above is the
    // rule being applied, not a --ci that never fails
    seed(['healthy', 'down', 'healthy', 'healthy', 'skipped']);
    const bad = cli(['--ci']);
    if (bad.status === 1) pass('control: --ci exits 1 when a cached canary is down');
    else fail(`control: --ci exited ${bad.status} on a cache with a down canary, want 1`);

    // control: degraded and skipped never fail the run (documented in provider-health.mjs)
    seed(['degraded', 'healthy', 'healthy', 'healthy', 'skipped']);
    const slow = cli(['--ci']);
    if (slow.status === 0) pass('control: a degraded canary does not fail --ci');
    else fail(`control: --ci exited ${slow.status} on a degraded-only cache, want 0`);
  } catch (e) {
    fail(`--ci assertion failed: ${e.message}`);
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
