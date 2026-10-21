// tests/shared-primitives.test.mjs — Workstream A of docs/AUDIT-FIX-PLAN.md.
// One table-driven check per shared primitive. Each has a control (the case
// that must keep working) next to the case that used to be wrong.
import { pass, fail, warn, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { normalizeCompany } from '../tracker-utils.mjs';
import { normalizeCompanyName } from '../lib/company-name.mjs';
import { decodeEntities, decodeXml } from '../providers/_html-entities.mjs';
import { isHttpUrl } from '../lib/url-guard.mjs';
import { isBlockedAddress, normalizeHost } from '../lib/net-guard.mjs';
import { withTimeout } from '../lib/with-timeout.mjs';
import { finalizeJobs, compact } from '../providers/_finalize.mjs';
import { assertPublicHttpsUrl } from '../lib/ats-detect.mjs';

console.log('\nshared primitives (audit workstream A)');

function eq(label, got, want) {
  if (got === want) pass(label);
  else fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── Unicode company key (finding 6) ─────────────────────────────────────
eq('normalizeCompany keeps Latin as before', normalizeCompany('Acme, Inc.'), 'acmeinc');
eq('normalizeCompany keeps Cyrillic', normalizeCompany('Яндекс'), 'яндекс');
eq('normalizeCompany keeps CJK', normalizeCompany('腾讯 (Tencent)'), '腾讯tencent');
eq('normalizeCompany keeps Arabic', normalizeCompany('أرامكو'), 'أرامكو');
eq('normalizeCompany NFKC folds fullwidth', normalizeCompany('ＡＢＣ'), 'abc');
{
  const a = normalizeCompany('Яндекс'), b = normalizeCompany('Сбер');
  if (a && b && a !== b) pass('two different Cyrillic companies get different keys (control)');
  else fail(`Cyrillic keys collapsed: ${JSON.stringify([a, b])}`);
}
eq('normalizeCompany of pure punctuation is "" (no key)', normalizeCompany('---'), '');
eq('normalizeCompanyName keeps Cyrillic', normalizeCompanyName('Яндекс'), 'яндекс');
eq('normalizeCompanyName still strips a legal suffix', normalizeCompanyName('Acme Inc.'), 'acme');

// ── dedup-tracker: Hired outranks a duplicate (5) and non-Latin dedup (6) ──
{
  const dir = mkdtempSync(join(tmpdir(), 'dedup-hired-'));
  let setupOk = false;
  const apps = join(dir, 'applications.md');
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(apps, [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-01-01 | Acme | Platform Engineer | 3.9/5 | Hired | ✅ | [1](reports/001-acme-2026-01-01.md) | took it |',
      '| 2 | 2026-01-02 | Acme | Platform Engineer | 4.2/5 | Evaluated | ❌ | [2](reports/002-acme-2026-01-02.md) | |',
      '| 3 | 2026-01-03 | Яндекс | Разработчик | 4.0/5 | Evaluated | ❌ | [3](reports/003-ya-2026-01-03.md) | |',
      '| 4 | 2026-01-04 | Сбер | Разработчик | 3.0/5 | Evaluated | ❌ | [4](reports/004-sber-2026-01-04.md) | |',
      '| 5 | 2026-01-05 | Gamma | Dev | 4.0/5 | Evaluated | ❌ | [5](reports/005-gamma-2026-01-05.md) | |',
      '| 6 | 2026-01-06 | Gamma | Dev | 3.0/5 | Evaluated | ❌ | [6](reports/006-gamma-2026-01-06.md) | |',
      '',
    ].join('\n'));
    setupOk = true;
  } catch (e) {
    warn(`dedup fixture could not be built: ${e.message}`);
  }
  if (setupOk) {
    const r = spawnSync(NODE, [join(ROOT, 'dedup-tracker.mjs')], { cwd: ROOT, env: { ...process.env, JOBBER_TRACKER: apps }, encoding: 'utf8' });
    const after = readFileSync(apps, 'utf8');
    const rows = after.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    const nums = rows.map((l) => l.split('|')[1].trim());
    if (r.status !== 0) fail(`dedup-tracker exited ${r.status}: ${r.stderr.slice(0, 200)}`);
    else {
      if (nums.includes('1') && /\| Hired \|/.test(rows.find((l) => l.startsWith('| 1 |')) || '')) pass('dedup keeps the Hired row over a higher-scored Evaluated duplicate');
      else fail(`Hired row lost or changed; remaining rows: ${nums.join(',')}`);
      if (nums.includes('3') && nums.includes('4')) pass('dedup does not merge two different Cyrillic companies');
      else fail(`Cyrillic companies merged; remaining rows: ${nums.join(',')}`);
      if (nums.includes('5') !== nums.includes('6')) pass('control: two Evaluated duplicates still collapse to one');
      else fail(`Gamma duplicates not deduped; remaining rows: ${nums.join(',')}`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── HTML/XML entities (N2, N1) ──────────────────────────────────────────
eq('decodeEntities does not resolve inherited object members', decodeEntities('A &constructor; B'), 'A &constructor; B');
eq('decodeEntities ignores &__proto__;', decodeEntities('&__proto__;'), '&__proto__;');
eq('decodeEntities control: &amp; still decodes', decodeEntities('R&amp;D'), 'R&D');
eq('decodeXml numeric hex slash', decodeXml('a&#x2F;b'), 'a/b');
eq('decodeXml decodes exactly once', decodeXml('R&#38;lt;b&#38;gt;'), 'R&lt;b&gt;');
eq('decodeXml leaves CDATA literal', decodeXml('<![CDATA[Sales &amp; Marketing]]>'), 'Sales &amp; Marketing');
eq('decodeXml decodes text around CDATA', decodeXml('A &amp; <![CDATA[B &amp; C]]> &lt;D'), 'A & B &amp; C <D');

// ── isHttpUrl ───────────────────────────────────────────────────────────
for (const [u, want] of [
  ['https://x.com/a', true], ['http://x.com', true],
  ['', false], ['/relative', false], ['javascript:alert(1)', false], ['ftp://x.com', false], ['httpx://x.com', false], [null, false], [42, false],
]) eq(`isHttpUrl(${JSON.stringify(u)})`, isHttpUrl(u), want);

// ── net-guard (13, N27) ─────────────────────────────────────────────────
const BLOCKED = [
  '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '198.19.255.255', '0.0.0.0', '224.0.0.1',
  '::', '::1', 'fe80::1', 'febf::1', 'fec0::1', 'fd00::1', 'fc00::1', 'ff02::1',
  '::ffff:127.0.0.1', '::ffff:7f00:1', '::127.0.0.1', '::10.0.0.1',
  '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1', '2002:a9fe:a9fe::', 'not-an-ip',
];
const ALLOWED = ['8.8.8.8', '1.1.1.1', '198.20.0.1', '2606:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1'];
for (const ip of BLOCKED) eq(`isBlockedAddress blocks ${ip}`, isBlockedAddress(ip), true);
for (const ip of ALLOWED) eq(`isBlockedAddress allows ${ip}`, isBlockedAddress(ip), false);
eq('normalizeHost strips trailing dots and case', normalizeHost('LocalHost.'), 'localhost');

// assertPublicHttpsUrl now sees through the trailing dot (13)
function rejects(url) { try { assertPublicHttpsUrl(url); return false; } catch { return true; } }
for (const u of ['https://localhost./', 'https://foo.internal./', 'https://printer.lan./']) eq(`assertPublicHttpsUrl rejects ${u}`, rejects(u), true);
eq('assertPublicHttpsUrl control: example.com. accepted', rejects('https://example.com./'), false);

// ── withTimeout ─────────────────────────────────────────────────────────
{
  const v = await withTimeout(Promise.resolve(7), 1000, 'fast');
  eq('withTimeout passes a fast promise through', v, 7);
  let msg = '';
  try { await withTimeout(new Promise(() => {}), 20, 'slow-co'); } catch (e) { msg = e.message; }
  eq('withTimeout rejects a hung promise with the label', msg, 'slow-co: timed out after 0s');
}

// ── finalizeJobs / compact ──────────────────────────────────────────────
{
  const errs = [];
  const orig = console.error;
  console.error = (m) => errs.push(String(m));
  const good = { title: 'Engineer', url: 'https://x.com/1', company: 'X', location: '' };
  const out = finalizeJobs('demo', [
    good,
    null,
    { ...good, url: 'https://x.com/2', title: '   ' },
    { ...good, url: '' },
    { ...good, url: '/relative' },
    { ...good, url: 'javascript:alert(1)' },
    { ...good, url: 'https://x.com/3', postedAt: 0, salary: { min: 0, max: 0, currency: 'USD' } },
    { ...good, url: 'https://x.com/4', postedAt: 1700000000000, salary: { min: 50000, max: null, currency: 'EUR' } },
    { ...good, url: 'https://x.com/5', salary: { min: 50000 } },
  ]);
  console.error = orig;
  const urls = out.map((j) => j.url);
  eq('finalizeJobs keeps exactly the valid urls, in order', urls.join(','), 'https://x.com/1,https://x.com/3,https://x.com/4,https://x.com/5');
  eq('finalizeJobs strips postedAt 0', 'postedAt' in out[1], false);
  eq('finalizeJobs strips a zero-bound salary', 'salary' in out[1], false);
  eq('finalizeJobs control: keeps postedAt and a one-sided salary', out[2].postedAt === 1700000000000 && out[2].salary.max === null, true);
  eq('finalizeJobs strips a salary missing keys', 'salary' in out[3], false);
  eq('finalizeJobs warns once with the count', errs.join('|'), 'demo: dropped 5 malformed postings');
  const notArray = { error: 'x' };
  eq('finalizeJobs passes a non-array through for the scanner to reject', finalizeJobs('demo', notArray), notArray);
  eq('compact drops null and non-objects', compact([{ a: 1 }, null, 'x', undefined, { b: 2 }]).length, 2);
  eq('compact turns a non-array into []', compact(null).length, 0);
}

// ── registry applies finalizeJobs to every loaded provider ───────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'reg-final-'));
  let setupOk = false;
  try {
    writeFileSync(join(dir, 'demo.mjs'), "export default { id: 'demo', detect: () => null, fetch: async () => [{ title: 'A', url: 'https://a.com/1' }, { title: 'B', url: '' }] };\n");
    setupOk = true;
  } catch (e) {
    warn(`registry fixture could not be built: ${e.message}`);
  }
  if (setupOk) {
    const { loadProviders } = await import('../providers/_registry.mjs');
    const providers = await loadProviders(dir);
    const orig = console.error; console.error = () => {};
    const jobs = await providers.get('demo').fetch({}, {});
    console.error = orig;
    eq('loadProviders wraps fetch: the url-less job is dropped, the good one kept', jobs.map((j) => j.title).join(','), 'A');
  }
  rmSync(dir, { recursive: true, force: true });
}
