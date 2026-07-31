// tests/providers/_contract.test.mjs — provider conformance suite (contract test).
//
// Loads every real providers/*.mjs implementation and asserts the shared
// Provider interface documented in _types.js — the substitutability check the
// registry (_registry.mjs) implies but cannot enforce in plain JS. Written
// once, this covers every provider today AND every provider added afterward,
// with zero per-provider work (HARDENING-PLAN.md Phase 2).
//
// Explicitly NO network: detect() and fetch() are both probed against a
// synthetic PortalEntry pointing at example.invalid (reserved by RFC 2606 —
// can never resolve), and the mock ctx.fetchJson/fetchText reject
// immediately with zero I/O. A provider that ignores the contract and tries
// to reach the network fails loudly (a thrown error / rejected promise,
// caught below) instead of silently succeeding against a real endpoint.
// Live-endpoint probing belongs to verify-portals.mjs, never here — a
// contract suite that touches the network becomes a flaky suite nobody
// trusts.
import { pass, fail, ROOT } from '../helpers.mjs';
import { readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider contract — conformance suite (all providers/*.mjs)');

const PROVIDERS_DIR = join(ROOT, 'providers');

// Keys documented on the Provider typedef in providers/_types.js. Anything
// else on a default export is either a typo (fetchJobs: instead of fetch:)
// or an undocumented contract extension — both should fail loudly rather
// than silently ship.
const ALLOWED_KEYS = new Set(['id', 'detect', 'fetch', 'enrichDate']);

const PROBE_ENTRY = {
  name: 'contract-probe',
  careers_url: 'https://example.invalid/careers',
  api: 'https://example.invalid/api',
};

const noNetwork = async () => { throw new Error('contract test: no network access'); };
const PROBE_CTX = {
  transport: 'http',
  fetchText: noNetwork,
  fetchJson: noNetwork,
  maxPages: 1,
  sleep: async () => {},
};

/**
 * Race a promise against a wall-clock budget. A provider whose fetch() body
 * retries/backs off in-process (no real I/O, since PROBE_CTX never resolves)
 * could otherwise stall the suite; a timeout is treated as inconclusive for
 * assertion #11, never as a failure.
 *
 * @param {Promise<any>} promise
 * @param {number} ms
 * @returns {Promise<any>}
 */
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ __contractTestTimedOut: true }), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); });
  });
}

const files = readdirSync(PROVIDERS_DIR)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
  .sort();

if (files.length === 0) {
  fail('no provider files found under providers/ — discovery is broken (0 providers checked)');
}

const seenIds = new Map(); // id -> owning file, for the global-uniqueness check

for (const file of files) {
  const label = `providers/${file}`;
  const expectedId = file.replace(/\.mjs$/, '');

  // #10 — file does not begin with `_`. Trivially true given the discovery
  // filter above; this is a self-check that a future filter regression
  // (e.g. someone loosens the `!startsWith('_')` guard) fails loudly here
  // instead of silently registering a shared helper as a provider.
  if (file.startsWith('_')) {
    fail(`${label}: discovery filter regression — a _-prefixed helper was iterated as a provider`);
    continue;
  }

  let mod;
  try {
    mod = await import(pathToFileURL(join(PROVIDERS_DIR, file)).href);
  } catch (err) {
    fail(`${label}: failed to import — ${err.message}`);
    continue;
  }

  const p = mod.default;

  // #1 — default export
  if (!p || typeof p !== 'object') {
    fail(`${label}: no default export (or default export is not an object)`);
    continue;
  }
  pass(`${label}: has a default export`);

  // #2 / #4 — id
  if (typeof p.id !== 'string' || p.id.length === 0) {
    fail(`${label}: id must be a non-empty string, got ${JSON.stringify(p.id)}`);
  } else {
    pass(`${label}: id is a non-empty string`);
  }
  if (p.id === expectedId) {
    pass(`${label}: id matches filename ("${p.id}")`);
  } else {
    fail(`${label}: id "${p.id}" does not match filename (expected "${expectedId}") — breaks "provider:" predictability in portals.yml`);
  }

  // #3 — global uniqueness across all loaded providers
  if (typeof p.id === 'string' && p.id.length > 0) {
    if (seenIds.has(p.id)) {
      fail(`${label}: duplicate id "${p.id}" — already used by providers/${seenIds.get(p.id)} (collisions silently shadow a board)`);
    } else {
      seenIds.set(p.id, file);
      pass(`${label}: id is globally unique so far`);
    }
  }

  // #5 / #6 — fetch
  if (typeof p.fetch !== 'function') {
    fail(`${label}: fetch must be a function`);
  } else {
    pass(`${label}: fetch is a function`);
    if (p.fetch.length >= 1) pass(`${label}: fetch accepts at least (entry) — arity ${p.fetch.length}`);
    else fail(`${label}: fetch has arity 0 — must accept (entry, ctx)`);
  }

  // #7 / #8 — detect, when present
  if (p.detect !== undefined) {
    if (typeof p.detect !== 'function') {
      fail(`${label}: detect, when present, must be a function`);
    } else {
      pass(`${label}: detect is a function`);
      let hit;
      let threw = false;
      try {
        hit = p.detect(PROBE_ENTRY);
      } catch (err) {
        fail(`${label}: detect() threw on a synthetic .invalid entry — ${err.message}`);
        threw = true;
      }
      if (!threw) {
        if (hit === null) pass(`${label}: detect() returns null for a non-matching entry`);
        else if (hit && typeof hit === 'object' && typeof hit.url === 'string') pass(`${label}: detect() returns { url } for a matching entry`);
        else fail(`${label}: detect() must return null or { url: string }, got ${JSON.stringify(hit)}`);
      }
    }
  }

  // enrichDate, when present, must be a function (optional hook documented
  // in _types.js; called generically by scan-ats-full.mjs when present).
  if (p.enrichDate !== undefined && typeof p.enrichDate !== 'function') {
    fail(`${label}: enrichDate, when present, must be a function`);
  }

  // #9 — no unexpected top-level keys
  const extraKeys = Object.keys(p).filter((k) => !ALLOWED_KEYS.has(k));
  if (extraKeys.length === 0) pass(`${label}: no unexpected top-level keys`);
  else fail(`${label}: unexpected top-level key(s) [${extraKeys.join(', ')}] — did you mean "fetch"/"detect"/"enrichDate"? (a mistyped key like "fetchJobs:" ships a silent no-op board)`);

  // #11 — salary shape, best-effort. fetch() is probed with a mock ctx whose
  // fetchJson/fetchText reject immediately (zero I/O); nearly every provider
  // throws or resolves to [] against it, so this fires only for a provider
  // that would return job data without needing the mocked network calls to
  // succeed. It exists as the tripwire for the Phase 0 annualization
  // invariant nonetheless: >= 1000 cannot know the real figure, but no
  // plausible ANNUAL salary in any currency falls below it, while every raw
  // hourly rate does.
  if (typeof p.fetch === 'function') {
    let jobs = [];
    try {
      const attempt = Promise.resolve()
        .then(() => p.fetch(PROBE_ENTRY, PROBE_CTX))
        .then((r) => (Array.isArray(r) ? r : []))
        .catch(() => []);
      const outcome = await withTimeout(attempt, 300);
      jobs = outcome && outcome.__contractTestTimedOut ? [] : outcome;
    } catch {
      jobs = [];
    }
    const validBound = (v) => v === null || (Number.isFinite(v) && v >= 0);
    for (const job of jobs || []) {
      if (!job || job.salary === undefined) continue;
      const { min, max, currency } = job.salary;
      // Key presence: `salary` is optional as a whole, but once present all
      // three keys must be — an unknown bound is null, an unknown currency ''.
      // Omitting a key instead reads as `undefined` downstream, which today's
      // consumers happen to tolerate (scan.mjs uses `??`) but the contract does
      // not promise, so a stricter future consumer would break silently.
      for (const key of ['min', 'max', 'currency']) {
        if (!(key in job.salary)) fail(`${label}: salary.${key} key is missing — when salary is present all three keys must be (null / '' for unknown, never omitted)`);
      }
      if (!validBound(min) || !validBound(max)) {
        fail(`${label}: salary.min/max must be null or a finite number >= 0, got min=${JSON.stringify(min)} max=${JSON.stringify(max)}`);
        continue;
      }
      const looksHourly = [min, max].some((v) => v !== null && v > 0 && v < 1000);
      if (looksHourly) fail(`${label}: salary value below 1000 looks like a raw hourly/weekly rate, not an annualized figure (Phase 0 invariant) — min=${min} max=${max}`);
      else pass(`${label}: salary shape is annualization-plausible`);
      if (typeof currency !== 'string') fail(`${label}: salary.currency must be a string (use '' when unknown), got ${JSON.stringify(currency)}`);
    }
  }
}

console.log(`\n  (${files.length} providers checked, ${seenIds.size} unique ids)`);
