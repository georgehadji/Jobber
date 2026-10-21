// tests/providers/eightfold.test.mjs — fixtures shaped like live Eightfold payloads (Microsoft pcsx, Netflix legacy v2; 2026-10-21), trimmed.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — eightfold');
const ok = (c, m) => (c ? pass(m) : fail(m));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/eightfold.mjs')).href);
  const p = mod.default;
  ok(p.id === 'eightfold', 'eightfold.id is "eightfold"');

  // detect
  ok(p.detect({ name: 'A', careers_url: 'https://acme.eightfold.ai/careers' })?.url === 'https://acme.eightfold.ai/careers', 'detect() *.eightfold.ai auto-detected');
  ok(p.detect({ name: 'MS', careers_url: 'https://apply.careers.microsoft.com/careers' }) === null, 'detect() vanity host NOT auto-claimed without provider (control)');
  ok(p.detect({ name: 'MS', provider: 'eightfold', careers_url: 'https://apply.careers.microsoft.com/careers' })?.url === 'https://apply.careers.microsoft.com/careers', 'detect() honours explicit provider for vanity host');
  ok(p.detect({ name: 'A', careers_url: 'http://acme.eightfold.ai/careers' }) === null, 'detect() rejects http');
  ok(p.detect({ name: 'A', careers_url: 'https://evil-eightfold.ai/careers' }) === null, 'detect() rejects lookalike evil-eightfold.ai');
  ok(p.detect({ name: 'A', careers_url: 'https://acme.eightfold.ai.evil.example/careers' }) === null, 'detect() rejects suffix-spoofed host');
  ok(p.detect({ name: 'A', careers_url: 'https://evil.example/acme.eightfold.ai/careers' }) === null, 'detect() rejects path-spoofed URL');
  for (const bad of ['https://127.0.0.1/careers', 'https://localhost/careers', 'https://intranet.internal/careers', 'https://169.254.169.254/careers', 'https://host.example:8443/careers', 'https://user:pw@host.example/careers', 'https://[::1]/careers']) {
    ok(p.detect({ name: 'X', provider: 'eightfold', careers_url: bad }) === null, `explicit provider still rejects ${bad}`);
  }
  ok(p.detect({ name: 'A' }) === null, 'detect() null without careers_url');

  // domain discovery
  const enc = '<div data-x="{&#34;domain&#34;: &#34;Microsoft.com&#34;, &#34;configPath&#34;: &#34;PCS&#34;}"></div>';
  ok(mod.parseDomainFromPage(enc) === 'microsoft.com', 'parseDomainFromPage reads entity-encoded domain');
  ok(mod.parseDomainFromPage('{"domain": "netflix.com"}') === 'netflix.com', 'parseDomainFromPage reads plain JSON domain');
  ok(mod.parseDomainFromPage('<p>nothing</p>') === null && mod.parseDomainFromPage(null) === null, 'parseDomainFromPage -> null when absent');

  // parsers
  const pcsx = {
    status: 200,
    data: {
      count: 3,
      positions: [
        { id: 1970393557040465, name: 'AI Workforce Specialist', locations: ['Singapore, Singapore, Singapore', 'Thailand, Bangkok, Bangkok'], postedTs: 1792470743, workLocationOption: 'onsite', positionUrl: '/careers/job/1970393557040465' },
        { id: 2, name: 'Remote Engineer', locations: ['Poland'], postedTs: 0, workLocationOption: 'remote' },
        { id: 'abc', name: 'Bad id' },
        { id: 4, name: '  ' },
      ],
    },
  };
  const a = mod.parseEightfoldPage(pcsx, 'pcsx', 'apply.careers.microsoft.com', 'Microsoft');
  ok(a.jobs.length === 2 && a.count === 3 && a.rows === 4, `pcsx page: 2 valid of 4 rows, count=3 (got ${a.jobs.length}/${a.rows}/${a.count})`);
  ok(a.jobs[0].url === 'https://apply.careers.microsoft.com/careers/job/1970393557040465' && a.jobs[0].company === 'Microsoft', 'url built from id on the tenant host');
  ok(a.jobs[0].location === 'Singapore, Singapore, Singapore; Thailand, Bangkok, Bangkok', 'multi-location joined');
  ok(a.jobs[0].postedAt === 1792470743000, 'postedTs (epoch seconds) -> epoch ms');
  ok(a.jobs[1].location === 'Poland, Remote' && !('postedAt' in a.jobs[1]), 'remote flag appended; zero date omitted');
  ok(!('description' in a.jobs[0]) && !('salary' in a.jobs[0]), 'no description / salary (not free in list)');

  const v2 = { count: 382, positions: [{ id: 790298014263, name: 'AI Engineer 6', location: 'Los Gatos,California,United States of America', locations: ['x'], t_create: 1721692800, work_location_option: 'onsite', canonicalPositionUrl: 'https://evil.example/steal' }] };
  const b = mod.parseEightfoldPage(v2, 'v2', 'explore.jobs.netflix.net', 'Netflix');
  ok(b.jobs[0].url === 'https://explore.jobs.netflix.net/careers/job/790298014263', 'v2 url is rebuilt on the tenant host (canonicalPositionUrl ignored)');
  ok(b.jobs[0].location === 'Los Gatos,California,United States of America' && b.jobs[0].postedAt === 1721692800000, 'v2 location + t_create');
  ok(mod.parseEightfoldPage(null, 'pcsx', 'h', 'C').jobs.length === 0 && mod.parseEightfoldPage({ data: {} }, 'pcsx', 'h', 'C').rows === 0, 'malformed payload -> empty page');
  ok(mod.listUrl('h.example', 'a.com', 'pcsx', 20) === 'https://h.example/api/pcsx/search?domain=a.com&query=&start=20&num=10&sort_by=relevance', 'listUrl pcsx');
  ok(mod.listUrl('h.example', 'a.com', 'v2', 0).startsWith('https://h.example/api/apply/v2/jobs?domain=a.com'), 'listUrl v2');

  // fetch — pcsx tenant, explicit domain, 3 pages of 1 row, count 3 => stop at count
  const mkRow = i => ({ id: 100 + i, name: `Job ${i}`, locations: ['Berlin'], postedTs: 1792470743 });
  const calls = [];
  const sleeps = [];
  const pcsxCtx = {
    sleep: async ms => { sleeps.push(ms); },
    fetchText: async () => { throw new Error('should not fetch page when domain is pinned'); },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const start = Number(new URL(url).searchParams.get('start'));
      return { data: { count: 3, positions: start >= 3 ? [] : [mkRow(start)] } };
    },
  };
  const entry = { name: 'Microsoft', provider: 'eightfold', domain: 'microsoft.com', careers_url: 'https://apply.careers.microsoft.com/careers' };
  const jobs = await p.fetch(entry, pcsxCtx);
  ok(jobs.length === 3 && calls.length === 3, `pcsx walk advances start by rows returned and stops at count (jobs=${jobs.length}, calls=${calls.length})`);
  ok(calls.map(c => new URL(c.url).searchParams.get('start')).join() === '0,1,2', 'start offsets are 0,1,2');
  ok(calls.every(c => c.opts?.redirect === 'error' && c.url.startsWith('https://apply.careers.microsoft.com/api/pcsx/search')), "every request is pcsx on the tenant host with redirect:'error'");
  ok(sleeps.length === 2, 'paces between pages');

  calls.length = 0;
  const capped = await p.fetch(entry, { ...pcsxCtx, maxPages: 1 });
  ok(calls.length === 1 && capped.length === 1, 'ctx.maxPages=1 stops after first page');

  // empty page backstop when count lies
  calls.length = 0;
  const liar = await p.fetch(entry, { ...pcsxCtx, fetchJson: async (url, opts) => { calls.push({ url, opts }); return { data: { count: 999, positions: calls.length === 1 ? [mkRow(1)] : [] } }; } });
  ok(liar.length === 1 && calls.length === 2, 'empty page ends the walk even if count is larger');

  // legacy fallback: pcsx 403 -> v2
  calls.length = 0;
  const v2Ctx = {
    sleep: async () => {},
    fetchText: async url => { calls.push({ url, opts: { text: true } }); return '<x data-d="{&#34;domain&#34;: &#34;netflix.com&#34;}">'; },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      if (url.includes('/api/pcsx/')) throw Object.assign(new Error('403'), { status: 403 });
      return { ...v2, count: 1 };
    },
  };
  const nf = await p.fetch({ name: 'Netflix', provider: 'eightfold', careers_url: 'https://explore.jobs.netflix.net/careers' }, v2Ctx);
  ok(calls[0].url === 'https://explore.jobs.netflix.net/careers' && calls[1].url.includes('/api/pcsx/search?domain=netflix.com'), 'domain discovered from careers page, then pcsx tried first');
  ok(calls[2].url.includes('/api/apply/v2/jobs?domain=netflix.com') && nf.length === 1, 'falls back to legacy v2 on 403');
  ok(calls.slice(1).every(c => c.opts?.redirect === 'error') && calls[0].opts?.text, "list requests keep redirect:'error'");

  // non-403 error must propagate (not masked by fallback); 429 retried
  let threw500 = false;
  try { await p.fetch(entry, { ...pcsxCtx, fetchJson: async () => { throw Object.assign(new Error('500'), { status: 500 }); } }); } catch { threw500 = true; }
  ok(threw500, 'non-403 error propagates');
  let n429 = 0;
  const retried = await p.fetch(entry, { ...pcsxCtx, fetchJson: async () => { n429++; if (n429 < 3) throw Object.assign(new Error('429'), { status: 429 }); return { data: { count: 1, positions: [mkRow(1)] } }; } });
  ok(retried.length === 1 && n429 === 3, '429 is retried then succeeds');
  let n429b = 0;
  let threw429 = false;
  try { await p.fetch(entry, { ...pcsxCtx, fetchJson: async () => { n429b++; throw Object.assign(new Error('429'), { status: 429 }); } }); } catch { threw429 = true; }
  ok(threw429 && n429b === 4, `persistent 429 gives up after 3 retries (attempts=${n429b})`);

  // domain not discoverable -> throws; hostile url -> no request
  let noDomain = false;
  try { await p.fetch({ name: 'X', provider: 'eightfold', careers_url: 'https://jobs.example.com/careers' }, { ...pcsxCtx, fetchText: async () => '<html></html>' }); } catch { noDomain = true; }
  ok(noDomain, 'fetch throws when tenant domain cannot be found');
  calls.length = 0;
  let hostile = false;
  try { await p.fetch({ name: 'E', provider: 'eightfold', careers_url: 'https://127.0.0.1/careers' }, pcsxCtx); } catch { hostile = true; }
  ok(hostile && calls.length === 0, 'fetch rejects hostile careers_url without any request');
} catch (e) {
  fail(`eightfold provider tests crashed: ${e.message}`);
}
