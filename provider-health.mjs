#!/usr/bin/env node
/**
 * provider-health.mjs — Zero-token canary health check for the major ATS APIs
 *
 * The zero-token scanner (scan.mjs) depends on ~70 provider adapters, each
 * hitting a public ATS API (Greenhouse, Lever, Ashby, Workday, BambooHR...).
 * When one of those APIs changes or goes down, scanning silently stops
 * producing results for that vendor — the user notices via a stats gap, not an
 * alert. This script is the preflight canary: it issues one lightweight
 * request per major vendor against a known-good public board and classifies
 * the result.
 *
 * Canary targets are deliberately stable public boards (a real company that
 * uses the vendor), fetched with a short timeout. A canary result reflects the
 * vendor API's health, not the health of any single tracked company.
 *
 * Statuses:
 *   - healthy   — HTTP 2xx and a parseable response within timeout
 *   - degraded  — HTTP 2xx but slow (>= 2s), or non-2xx but the API answered
 *                 (4xx/5xx = the API is reachable but unhappy)
 *   - down      — timeout, connection refused, DNS failure, or no response
 *   - skipped   — provider not canary-able (no stable public board to probe)
 *
 * Output modes:
 *   --json     — structured { provider, status, latencyMs, error? }[]
 *   --summary  — human-readable table (default)
 *   --ci       — exit 1 if any provider is DOWN (for scheduled CI monitoring)
 *
 * Cache: results are cached for 15 minutes (file under os.tmpdir()) so a
 * repeated `node scan.mjs --health-check` preflight doesn't hammer the APIs.
 * Use --no-cache to force fresh canaries.
 *
 * Run:
 *   node provider-health.mjs                (summary)
 *   node provider-health.mjs --json
 *   node provider-health.mjs --ci           (exit 1 on any DOWN)
 *   node provider-health.mjs --no-cache     (force fresh)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const JOBBER = dirname(fileURLToPath(import.meta.url));
const CACHE_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 10_000;
// First probe on a machine pays DNS + TLS + connection setup; 3s separates a
// genuinely slow API from cold-start cost. Tune via JOBBER_HEALTH_SLOW_MS.
const SLOW_MS = Number(process.env.JOBBER_HEALTH_SLOW_MS) || 3_000;
// Cache location is overridable (JOBBER_HEALTH_CACHE) so tests can isolate
// without touching the user's real cache — os.tmpdir() ignores TMPDIR on
// Windows, so env override is the portable isolation mechanism.
const CACHE_FILE = process.env.JOBBER_HEALTH_CACHE
  ? process.env.JOBBER_HEALTH_CACHE
  : join(tmpdir(), 'jobber-provider-health.json');

const JSON_OUT = process.argv.includes('--json');
const CI_MODE = process.argv.includes('--ci');
const NO_CACHE = process.argv.includes('--no-cache');
const SUMMARY = !JSON_OUT; // summary is the default (matches stats.mjs style)

/**
 * Canary targets — one stable, well-known public board per major ATS vendor.
 * These are chosen for stability, not affiliation: a real company that uses
 * the vendor's public board API without auth.
 *
 * @type {Array<{id: string, name: string, url: string, method?: string, body?: string, headers?: object}>}
 */
const CANARIES = [
  {
    id: 'greenhouse',
    name: 'Greenhouse',
    url: 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=false',
  },
  {
    id: 'lever',
    name: 'Lever',
    url: 'https://api.lever.co/v0/postings/mistral?mode=json',
  },
  {
    id: 'ashby',
    name: 'Ashby',
    url: 'https://api.ashbyhq.com/posting-api/job-board/attio?includeCompensation=false',
  },
  {
    id: 'workday',
    name: 'Workday',
    url: 'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 1, offset: 0, searchText: '', appliedFacets: {} }),
  },
  {
    id: 'bamboohr',
    name: 'BambooHR',
    url: 'https://api.bamboohr.com/api/gateway.php',
    // BambooHR's public API requires a tenant + API key; there is no stable
    // anonymous public board to probe. Reported as skipped rather than
    // inventing a fake health signal.
    requiresAuth: true,
  },
];

/**
 * Issue one canary request with a hard timeout.
 *
 * @param {object} c - Canary target from CANARIES.
 * @returns {Promise<{status: string, latencyMs: number, error?: string}>}
 */
async function probeCanary(c) {
  if (c.requiresAuth) {
    return { status: 'skipped', latencyMs: 0, error: 'no anonymous public board to probe (auth-gated API)' };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(c.url, {
      method: c.method || 'GET',
      headers: c.headers || {},
      body: c.body || undefined,
      signal: controller.signal,
      redirect: 'follow',
    });
    const latencyMs = Date.now() - started;
    // Consume a little of the body so a 200 with garbage still counts as a
    // response (the canary asks "is the API alive?", not "is the payload sane").
    await res.arrayBuffer().catch(() => {});
    if (latencyMs >= SLOW_MS) {
      return { status: 'degraded', latencyMs, error: `slow response (${res.status})` };
    }
    if (res.ok) {
      return { status: 'healthy', latencyMs };
    }
    return { status: 'degraded', latencyMs, error: `HTTP ${res.status}` };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const reason = err?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : (err?.cause?.code || err?.message || String(err));
    return { status: 'down', latencyMs, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run all canaries in parallel and fold in the cache.
 *
 * @returns {Promise<Array<object>>} Results in CANARIES order.
 */
export async function runHealthChecks() {
  const results = await Promise.all(CANARIES.map(probeCanary));
  return CANARIES.map((c, i) => ({ provider: c.id, name: c.name, ...results[i] }));
}

/**
 * Load cached results when fresh, else null.
 *
 * @returns {Array<object>|null}
 */
function loadCache() {
  if (NO_CACHE || !existsSync(CACHE_FILE)) return null;
  try {
    const { ts, results } = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - ts < CACHE_MS) return results;
  } catch { /* corrupted or partial cache — ignore */ }
  return null;
}

/**
 * Write results to the cache file (best-effort).
 *
 * @param {Array<object>} results - Results from runHealthChecks().
 * @returns {void}
 */
function saveCache(results) {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), results }, null, 2));
  } catch { /* cache is a convenience, never fatal */ }
}

// ---- Main ----
const cached = loadCache();
const results = cached ?? (await runHealthChecks());
if (!cached) saveCache(results);

const STATUS_ICON = { healthy: '✅', degraded: '⚠️', down: '❌', skipped: '⏭️' };
const downCount = results.filter(r => r.status === 'down').length;

if (JSON_OUT) {
  console.log(JSON.stringify({ cached: !!cached, results }, null, 2));
} else if (SUMMARY) {
  if (cached) console.log('(cached results — use --no-cache for a fresh check)');
  for (const r of results) {
    const lat = r.latencyMs ? `${r.latencyMs}ms` : '';
    const err = r.error ? ` — ${r.error}` : '';
    console.log(`${STATUS_ICON[r.status] || '❓'} ${r.name}: ${r.status}${lat ? ` (${lat})` : ''}${err}`);
  }
  console.log(`\n${results.length - downCount}/${results.length} providers operational`);
}

// --ci exits 1 when any provider is DOWN. Degraded/skipped do not fail the
// run (a slow API is worth knowing about, not worth blocking a deploy on).
if (CI_MODE && downCount > 0) process.exit(1);
process.exit(0);
