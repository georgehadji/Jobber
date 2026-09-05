// tests/plugin-sandbox-assertions.test.mjs — three assertions in test-all.mjs
// §49 (plugin engine sandbox + firewall) could not distinguish the property they
// name from an unrelated cause (defect-hunt batch 15).
//
// The plugin engine's own behaviour was verified correct in all three cases —
// this batch found no production defect. What it found is that these tests would
// not have noticed if that stopped being true.
//
// B15-D1 (MEDIUM): one outer catch covered BOTH the symlink fixture setup and
//   the hashPluginTree call, setting the "rejected" flag either way. On a machine
//   that refuses symlinks, setup threw and the assertion reported pass with
//   hashPluginTree never called — silently, unlike the sibling symlink block
//   ~150 lines above which warns when it skips.
// B15-D2 (LOW): the id-vs-dirname assertion validated at a hardcoded '/tmp/x'.
//   Nothing exists there, so every manifest is rejected — for the missing entry,
//   not the id. Correct today only because the id check happens to run first.
// B15-D3 (LOW): the credential-strip assertion inspected only the cross-host
//   request. "Strips on hostname change" and "never forwards the header at all"
//   were indistinguishable, and same-host retention was untested.
import { mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntest-all.mjs §49 — sandbox assertions discriminate their own property (B15)');

const { validateManifest, buildCtx } = await import(pathToFileURL(join(ROOT, 'plugins/_engine.mjs')).href);

// ── B15-D2, behavioural: the id rule is what rejects, not a missing path ──
const base = { id: 'x', apiVersion: 1, description: 'one line', hooks: ['ingest'], requiredEnv: [], allowedHosts: [], humanInTheLoop: true };
const mtmp = mkdtempSync(join(tmpdir(), 'b15-manifest-'));
mkdirSync(join(mtmp, 'x'), { recursive: true });

const reasons = [];
const origWarn = console.warn;
console.warn = (...a) => reasons.push(a.join(' '));
const vm = (m) => { reasons.length = 0; return validateManifest(m, join(mtmp, 'x'), 'x'); };

const baseOk = vm({ ...base });
console.warn = origWarn;
if (baseOk !== null) {
  pass('the §49 fixture accepts an unmodified base manifest — rejections there are attributable');
} else {
  fail(`the §49 fixture rejects its own base manifest (${reasons[0] || 'no reason given'}) — every rejection assertion built on it passes vacuously`);
}

console.warn = (...a) => reasons.push(a.join(' '));
const idRejected = vm({ ...base, id: 'y' });
console.warn = origWarn;
if (idRejected === null && reasons.some((r) => /must equal directory name/i.test(r))) {
  pass('a mismatched id is rejected FOR THE ID RULE, not for an unrelated reason');
} else if (idRejected === null) {
  fail(`a mismatched id was rejected, but for "${reasons[0] || 'no stated reason'}" — the assertion does not test the id rule`);
} else {
  fail('a mismatched id was accepted');
}

// ── B15-D3, behavioural: both directions of the credential rule ──
process.env.G_TOKEN = 'secret';
const gctx = buildCtx({ id: 'g', requiredEnv: ['G_TOKEN'], optionalEnv: [], allowedHosts: ['93.184.216.34', '93.184.216.35'], allowsLocalhost: false });
const calls = [];
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), headers: { ...(opts?.headers || {}) } });
  const u = String(url);
  if (u === 'https://93.184.216.34/start') return new Response(null, { status: 302, headers: { location: 'https://93.184.216.35/final' } });
  if (u === 'https://93.184.216.35/final') return new Response('{}', { status: 200 });
  if (u === 'https://93.184.216.34/same') return new Response(null, { status: 302, headers: { location: 'https://93.184.216.34/same2' } });
  if (u === 'https://93.184.216.34/same2') return new Response('{}', { status: 200 });
  return new Response('nope', { status: 404 });
};
const hasAuth = (c) => !!c && Object.keys(c.headers).some((k) => /^authorization$/i.test(k));
try {
  calls.length = 0;
  await gctx.fetch('https://93.184.216.34/start', { headers: { Authorization: 'Bearer secret' } });
  const first = calls.find((c) => c.url === 'https://93.184.216.34/start');
  const cross = calls.find((c) => c.url === 'https://93.184.216.35/final');
  if (hasAuth(first)) pass('Authorization IS sent on the first hop — the strip assertion is not vacuous');
  else fail('Authorization never leaves ctx.fetch, so a cross-host absence check proves nothing');
  if (cross && !hasAuth(cross)) pass('Authorization is stripped on a cross-host redirect');
  else fail('Authorization survived a cross-host redirect — credential leak to a second host');

  calls.length = 0;
  await gctx.fetch('https://93.184.216.34/same', { headers: { Authorization: 'Bearer secret' } });
  const sameHop = calls.find((c) => c.url === 'https://93.184.216.34/same2');
  if (hasAuth(sameHop)) pass('Authorization is kept across a same-host redirect');
  else fail('Authorization was stripped on a same-host redirect — would break authenticated plugins');
} finally {
  globalThis.fetch = origFetch;
  delete process.env.G_TOKEN;
}

// ── B15-D1, source: setup failure must not be reported as the property holding ──
// Checks for the corrected shape's presence, never the absence of the old one:
// the fixed code documents the defect in comments that quote it (the constraint
// recorded in batches 11, 12 and 14).
const src = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8');
const lockBlock = src.slice(src.indexOf('Lock / rug-pull defense'), src.indexOf('Registry + audit + install naming'));
if (/symSetup = false;[\s\S]{0,200}?\bwarn\(/.test(lockBlock)) {
  pass('a symlink fixture that cannot be created warns, instead of counting as the property holding');
} else {
  fail('the lock symlink test no longer separates setup failure from the security check — it will pass on any machine that refuses symlinks (B15-D1)');
}
if (/if \(symSetup\) \{[\s\S]{0,300}?hashPluginTree\(symDir\)/.test(lockBlock)) {
  pass('hashPluginTree is only asserted on when the symlink fixture actually exists');
} else {
  fail('the hashPluginTree assertion is no longer gated on a successful fixture (B15-D1)');
}
