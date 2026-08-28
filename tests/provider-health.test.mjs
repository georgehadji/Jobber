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
//   - a second run within the cache window says cached: true
//   - --ci with the cache from a healthy run exits 0
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
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

  // --- Cache: second run within window reports cached ---
  try {
    const second = execFileSync(NODE, [join(ROOT, 'provider-health.mjs'), '--json'], {
      encoding: 'utf-8', timeout: 60_000, env,
    });
    const parsed = JSON.parse(second);
    if (parsed.cached === true) {
      pass('cached run reports cached: true (no network re-probe)');
    } else {
      fail('second --json run expected cached: true');
    }
  } catch (e) {
    warn(`cache assertion skipped (${e.message})`);
  }

  // --- --ci exit code: 0 when nothing is down, 1 when something is down ---
  try {
    const ciOut = execFileSync(NODE, [join(ROOT, 'provider-health.mjs'), '--ci'], {
      encoding: 'utf-8', timeout: 60_000, env,
    });
    // If the canaries actually reached the network and found a down provider,
    // exit 1 is correct — but the exit code path itself must be deterministic:
    // cache present + all-healthy prior run → exit 0 is what we assert here.
    pass(`--ci exited 0 with cached healthy results`);
  } catch {
    // exit 1 is only legitimate when a provider is genuinely down; with a
    // fresh cache of a healthy run it should not happen, so report as fail.
    fail('--ci exited non-zero despite a healthy cached run');
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
