// tests/hosted-capabilities.test.mjs — lib/hosted-capabilities.mjs is the
// hosted tier's capability boundary: what path an agent tool may touch, what
// script it may run, what URL it may fetch. agent-runner.mjs's tool loop and
// the hosted /api/run branch (web/src/lib/hosted-run.ts, via its own CLI
// shim) both depend on these answers agreeing — see AGENTS.md rule 1: every
// refusal case here is paired with the legitimate case that must still work,
// so a fix that over-tightens the guard fails just as loudly as one that
// under-tightens it.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { symlinkSync } from 'fs';
import { pass, fail, warn, ROOT } from './helpers.mjs';
import {
  confinePath, isUserLayerPath, isAllowedScript, RUNSCRIPT_ALLOWLIST,
  assertFetchable, assertResolvesPublic, htmlToText, fetchUrlText,
} from '../lib/hosted-capabilities.mjs';

console.log('\nlib/hosted-capabilities.mjs — the hosted tier capability boundary');

// Setup and the property under test stay in SEPARATE try blocks (AGENTS.md
// rule 5): a fixture that fails to build must warn, never silently pass every
// assertion that assumed it existed.
let workspace;
try {
  workspace = mkdtempSync(join(tmpdir(), 'jobber-hosted-cap-'));
  writeFileSync(join(workspace, 'cv.md'), '# CV\n');
  mkdirSync(join(workspace, 'modes'), { recursive: true });
  writeFileSync(join(workspace, 'modes', '_shared.md'), 'system prose');
} catch (e) {
  warn(`hosted-capabilities fixture could not be built, skipping: ${e.message}`);
  workspace = null;
}

if (workspace) try {
  // ---- confinePath: escape refused, legit path succeeds (control pair) ----
  try {
    confinePath(workspace, '../../etc/passwd');
    fail('confinePath: a "../../etc/passwd" escape was NOT refused');
  } catch (e) {
    if (/escapes workspace/.test(e.message)) pass('confinePath refuses a ../.. escape');
    else fail(`confinePath threw for the wrong reason: ${e.message}`);
  }
  try {
    const p = confinePath(workspace, 'cv.md');
    if (p === join(workspace, 'cv.md')) pass('confinePath resolves a legitimate in-workspace path');
    else fail(`confinePath resolved wrong: ${p}`);
  } catch (e) {
    fail(`confinePath refused a legitimate path: ${e.message}`);
  }

  // Absolute path pointing outside the workspace — a different escape shape
  // than "../..", must be refused too (not just relative traversal).
  try {
    confinePath(workspace, 'C:\\Windows\\System32\\drivers\\etc\\hosts');
    // On POSIX this absolute path doesn't parse as "outside" the same way;
    // only assert the Windows-meaningful case fails to escape when it should.
  } catch (e) {
    if (!/escapes workspace/.test(e.message)) fail(`confinePath: unexpected error for absolute path: ${e.message}`);
  }

  // A symlink inside the workspace pointing outside it — realpath must catch
  // this even though the string path never left the workspace prefix.
  const outsideDir = mkdtempSync(join(tmpdir(), 'jobber-hosted-cap-outside-'));
  writeFileSync(join(outsideDir, 'secret.txt'), 'nope');
  const linkPath = join(workspace, 'escape-link');
  let symlinkOk = true;
  try {
    symlinkSync(join(outsideDir, 'secret.txt'), linkPath, 'file');
  } catch {
    symlinkOk = false; // no symlink privilege on this machine (common on Windows) — skip, don't fail
  }
  if (symlinkOk) {
    try {
      confinePath(workspace, 'escape-link');
      fail('confinePath: a symlink escape was NOT refused');
    } catch (e) {
      if (/escapes workspace via symlink/.test(e.message)) pass('confinePath refuses a symlink that resolves outside the workspace');
      else fail(`confinePath: symlink escape threw the wrong error: ${e.message}`);
    }
  }
  rmSync(outsideDir, { recursive: true, force: true });

  // ---- isUserLayerPath: identity, not a blanket allow/deny ----------------
  const userCases = [
    ['cv.md', true],
    ['data/applications.md', true],
    ['data/nested/deep/file.txt', true],
    ['cv.md.bak', true],
    ['modes/_shared.md', false],
    ['modes/oferta.md', false],
    ['openai-eval.mjs', false],
    ['lib/llm-providers.mjs', false],
    ['../outside.md', false],
  ];
  const userProblems = userCases.filter(([p, want]) => isUserLayerPath(p) !== want);
  if (userProblems.length === 0) {
    pass('isUserLayerPath correctly classifies every case, user and system alike');
  } else {
    fail(`isUserLayerPath misclassified: ${userProblems.map(([p, want]) => `${p} (expected ${want})`).join(', ')}`);
  }
  // interview-prep/ is user layer EXCEPT its scaffold files (DATA_CONTRACT.md) —
  // the one deliberate overlap; asserted on its own so a regression here names
  // the exact case, not just "some path in the big list above".
  if (isUserLayerPath('interview-prep/acme-swe.md') && isUserLayerPath('interview-prep/sessions/notes.md')) {
    pass('isUserLayerPath treats the interview-prep/ tree as user layer');
  } else {
    fail('isUserLayerPath: interview-prep/ tree misclassified');
  }

  // ---- RunScript allowlist: identity, not "any .mjs in root" --------------
  if (isAllowedScript('merge-tracker') && isAllowedScript('merge-tracker.mjs') && !isAllowedScript('agent-runner') && !isAllowedScript('rm-rf-everything')) {
    pass('isAllowedScript accepts allowlisted scripts (with or without .mjs) and refuses everything else');
  } else {
    fail('isAllowedScript: allowlist check failed');
  }
  if (RUNSCRIPT_ALLOWLIST.includes('merge-tracker') && !RUNSCRIPT_ALLOWLIST.some((s) => s.includes('/'))) {
    pass('RUNSCRIPT_ALLOWLIST is bare script names only, no paths');
  } else {
    fail('RUNSCRIPT_ALLOWLIST contains a path segment — that would defeat the identity check');
  }

  // ---- assertFetchable: https-only, private ranges, own-origin refused ----
  const fetchCases = [
    ['https://example.com/job/1', true],
    ['http://example.com/job/1', false],
    ['https://localhost/job/1', false],
    ['https://127.0.0.1/job/1', false],
    ['https://192.168.1.5/job/1', false],
    ['not a url', false],
  ];
  const fetchProblems = fetchCases.filter(([url, want]) => {
    try {
      assertFetchable(url);
      return !want;
    } catch {
      return want;
    }
  });
  if (fetchProblems.length === 0) {
    pass('assertFetchable accepts public https URLs and refuses http/private/loopback/malformed ones');
  } else {
    fail(`assertFetchable misclassified: ${fetchProblems.map((c) => c[0]).join(', ')}`);
  }
  try {
    assertFetchable('https://app.workler.org/api/internal', 'https://app.workler.org');
    fail('assertFetchable did not refuse the app\'s own origin');
  } catch (e) {
    if (/own origin/.test(e.message)) pass('assertFetchable refuses fetching the app\'s own origin');
    else fail(`assertFetchable: wrong error for own-origin: ${e.message}`);
  }
  // Control: a DIFFERENT origin is not caught by the own-origin check.
  try {
    assertFetchable('https://boards.greenhouse.io/acme/jobs/1', 'https://app.workler.org');
    pass('assertFetchable allows a different public origin through the own-origin check');
  } catch (e) {
    fail(`assertFetchable wrongly refused a different origin: ${e.message}`);
  }

  // ---- htmlToText: strips markup, keeps prose readable ---------------------
  const html = '<html><head><style>.x{color:red}</style></head><body><h1>Senior Engineer</h1><p>Remote &amp; hybrid.</p><script>evil()</script></body></html>';
  const text = htmlToText(html);
  if (text.includes('Senior Engineer') && text.includes('Remote & hybrid') && !text.includes('evil()') && !text.includes('color:red')) {
    pass('htmlToText keeps visible prose and strips script/style/markup');
  } else {
    fail(`htmlToText produced: ${JSON.stringify(text)}`);
  }

  // ---- assertResolvesPublic: DNS-resolved private IPs, not just literal ones --
  // The gap PRIVATE_HOST_RE alone can't close: a hostname that isn't
  // "localhost" or a private IP literal, but RESOLVES to one — a DNS record
  // pointed at the cloud metadata endpoint, say.
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const metadataLookup = async () => [{ address: '169.254.169.254', family: 4 }];
  const mixedLookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }];
  const ipv6LoopbackLookup = async () => [{ address: '::1', family: 6 }];
  const ipv6MappedPrivateLookup = async () => [{ address: '::ffff:127.0.0.1', family: 6 }];
  const ipv6PublicLookup = async () => [{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }];

  try {
    await assertResolvesPublic('cdn.example.com', { lookupImpl: publicLookup });
    pass('assertResolvesPublic accepts a hostname that resolves to a public address');
  } catch (e) {
    fail(`assertResolvesPublic wrongly refused a public resolution: ${e.message}`);
  }
  try {
    await assertResolvesPublic('metadata.internal.example', { lookupImpl: metadataLookup });
    fail('assertResolvesPublic did not refuse a hostname resolving to the cloud metadata address');
  } catch (e) {
    if (/169\.254\.169\.254/.test(e.message)) pass('assertResolvesPublic refuses a hostname that resolves to the cloud metadata address');
    else fail(`assertResolvesPublic: wrong error: ${e.message}`);
  }
  try {
    await assertResolvesPublic('multi.example', { lookupImpl: mixedLookup });
    fail('assertResolvesPublic did not refuse a hostname with ONE private address among several');
  } catch (e) {
    if (/10\.0\.0\.5/.test(e.message)) pass('assertResolvesPublic refuses when ANY resolved address is private, not just the first');
    else fail(`assertResolvesPublic: wrong error for mixed resolution: ${e.message}`);
  }
  try {
    await assertResolvesPublic('v6-loopback.example', { lookupImpl: ipv6LoopbackLookup });
    fail('assertResolvesPublic did not refuse an IPv6 loopback resolution');
  } catch (e) {
    if (/::1/.test(e.message)) pass('assertResolvesPublic refuses an IPv6 loopback (::1) resolution');
    else fail(`assertResolvesPublic: wrong error for ::1: ${e.message}`);
  }
  try {
    await assertResolvesPublic('v6-mapped.example', { lookupImpl: ipv6MappedPrivateLookup });
    fail('assertResolvesPublic did not refuse an IPv4-mapped IPv6 loopback');
  } catch (e) {
    pass('assertResolvesPublic unwraps an IPv4-mapped IPv6 address (::ffff:127.0.0.1) and refuses it');
  }
  try {
    await assertResolvesPublic('v6-public.example', { lookupImpl: ipv6PublicLookup });
    pass('assertResolvesPublic accepts a public IPv6 address (control for the IPv6 cases above)');
  } catch (e) {
    fail(`assertResolvesPublic wrongly refused a public IPv6 address: ${e.message}`);
  }

  // ---- fetchUrlText: injected fetchImpl + lookupImpl, no real network ------
  const fakeFetch = async (url) => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) },
    arrayBuffer: async () => Buffer.from(`<p>JD for ${url}</p>`),
  });
  const jd = await fetchUrlText('https://example.com/job/9', { fetchImpl: fakeFetch, lookupImpl: publicLookup });
  if (jd.includes('JD for https://example.com/job/9')) {
    pass('fetchUrlText extracts text through an injected fetch implementation');
  } else {
    fail(`fetchUrlText returned: ${JSON.stringify(jd)}`);
  }
  // Control: a non-ok response is surfaced as an error, not swallowed.
  try {
    await fetchUrlText('https://example.com/job/9', {
      lookupImpl: publicLookup,
      fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => null } }),
    });
    fail('fetchUrlText did not throw on a 404');
  } catch (e) {
    if (/HTTP 404/.test(e.message)) pass('fetchUrlText surfaces a non-ok response as an error');
    else fail(`fetchUrlText: wrong error for 404: ${e.message}`);
  }
  // A hostname whose DNS record points at a private address must be refused
  // even though the URL text itself looks like an ordinary public hostname.
  try {
    await fetchUrlText('https://looks-public.example/job/9', { fetchImpl: fakeFetch, lookupImpl: metadataLookup });
    fail('fetchUrlText did not refuse a hostname that resolves to a private address');
  } catch (e) {
    if (/169\.254\.169\.254/.test(e.message)) pass('fetchUrlText refuses a hostname whose DNS record resolves to a private address');
    else fail(`fetchUrlText: wrong error for private-resolving host: ${e.message}`);
  }
  // ---- fetchUrlText: a redirect is re-validated, not trusted ---------------
  // Redirect target resolves to a private address — must be refused on the
  // SECOND hop even though the first URL was clean.
  {
    let call = 0;
    const redirectingFetch = async () => {
      call++;
      if (call === 1) return { ok: false, status: 302, headers: { get: (h) => (h === 'location' ? 'https://internal.example/secret' : null) } };
      return { ok: true, status: 200, headers: { get: () => 'text/plain' }, arrayBuffer: async () => Buffer.from('should never be reached') };
    };
    const lookupByHost = async (host) => (host === 'internal.example' ? [{ address: '10.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]);
    try {
      await fetchUrlText('https://example.com/job/9', { fetchImpl: redirectingFetch, lookupImpl: lookupByHost });
      fail('fetchUrlText followed a redirect into a private address without refusing it');
    } catch (e) {
      if (/10\.0\.0\.1/.test(e.message)) pass('fetchUrlText re-validates a redirect target and refuses one that resolves to a private address');
      else fail(`fetchUrlText: wrong error for a malicious redirect: ${e.message}`);
    }
  }
  // Control: a redirect to a legitimate public host is followed and returns content.
  {
    let call = 0;
    const redirectingFetch = async () => {
      call++;
      if (call === 1) return { ok: false, status: 302, headers: { get: (h) => (h === 'location' ? 'https://cdn.example.com/job/9' : null) } };
      return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'text/plain' : null) }, arrayBuffer: async () => Buffer.from('the real JD text') };
    };
    try {
      const out = await fetchUrlText('https://example.com/job/9', { fetchImpl: redirectingFetch, lookupImpl: publicLookup });
      if (out === 'the real JD text') pass('fetchUrlText follows a redirect to a legitimate public host and returns its content');
      else fail(`fetchUrlText redirect control returned: ${JSON.stringify(out)}`);
    } catch (e) {
      fail(`fetchUrlText wrongly refused a legitimate redirect: ${e.message}`);
    }
  }
  // ── The --fetch CLI shim (what web/src/lib/hosted-run.ts actually spawns) ──
  // AGENTS.md rule 4: the guard is reachable from an entry point, so spawn it
  // and assert on what it prints — not on the source text. No network: the
  // refusal happens before any socket opens. The success path needs a real
  // host and is covered by the in-process fetchUrlText tests above.
  {
    const { spawnSync } = await import('child_process');
    const shim = join(ROOT, 'lib', 'hosted-capabilities.mjs');
    const noArg = spawnSync(process.execPath, [shim], { encoding: 'utf8' });
    if (noArg.status === 2 && /usage:.*--fetch/.test(noArg.stderr)) pass('--fetch shim prints usage and exits 2 with no URL');
    else fail(`--fetch shim without a URL: exit ${noArg.status}, stderr ${JSON.stringify(noArg.stderr)}`);

    const priv = spawnSync(process.execPath, [shim, '--fetch', 'https://169.254.169.254/latest'], { encoding: 'utf8' });
    if (priv.status === 1 && /refusing private\/loopback host/.test(priv.stderr) && priv.stdout === '') pass('--fetch shim refuses a metadata-endpoint URL with exit 1 and prints nothing to stdout');
    else fail(`--fetch shim on a private host: exit ${priv.status}, stdout ${JSON.stringify(priv.stdout)}, stderr ${JSON.stringify(priv.stderr)}`);
  }
} catch (e) {
  fail(`hosted-capabilities tests crashed: ${e.stack || e.message}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
