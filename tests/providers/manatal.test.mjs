// tests/providers/manatal.test.mjs — fixture shaped like the live open.api.manatal.com payload (2026-10-21).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — manatal');
const ok = (c, m) => (c ? pass(m) : fail(m));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/manatal.mjs')).href);
  const p = mod.default;

  ok(p.id === 'manatal', 'manatal.id is "manatal"');

  // detect: positive (path + subdomain) / negative
  const d1 = p.detect({ name: 'DJ', careers_url: 'https://www.careers-page.com/davidjoseph-co' });
  ok(d1?.url === 'https://open.api.manatal.com/open/v3/career-page/davidjoseph-co/jobs/', 'detect() path form -> API list URL');
  const d2 = p.detect({ name: 'DJ', careers_url: 'https://davidjoseph-co.careers-page.com/job/W39XV566' });
  ok(d2?.url?.includes('/davidjoseph-co/jobs/'), 'detect() subdomain form -> API list URL');
  ok(p.detect({ name: 'X', careers_url: 'http://www.careers-page.com/acme' }) === null, 'detect() rejects http scheme');
  ok(p.detect({ name: 'X', careers_url: 'https://evil-careers-page.com/acme' }) === null, 'detect() rejects lookalike evil-careers-page.com');
  ok(p.detect({ name: 'X', careers_url: 'https://careers-page.com.evil.example/acme' }) === null, 'detect() rejects suffix-spoofed host');
  ok(p.detect({ name: 'X', careers_url: 'https://evil.example/www.careers-page.com/acme' }) === null, 'detect() rejects path-spoofed URL');
  ok(p.detect({ name: 'X', careers_url: 'https://www.careers-page.com/' }) === null, 'detect() null when no slug');
  ok(p.detect({ name: 'X', careers_url: null }) === null, 'detect() null for non-string careers_url');

  // parser
  const page1 = {
    count: 3,
    next: 'https://open.api.manatal.com/open/v3/career-page/acme/jobs/?page=2',
    previous: null,
    results: [
      { id: 1, hash: 'W39XV566', position_name: 'Account Executive', description: '<h3>Role</h3><p>Sell &amp; grow.</p>', location_display: 'New York, New York, United States', is_remote: true, contract_details: 'full_time' },
      { id: 2, hash: 'AB12', position_name: 'Designer', description: '', city: 'Berlin', country: 'Germany', is_remote: null },
      { id: 3, hash: '', position_name: 'No hash', description: '' },
      { id: 4, hash: 'ZZ9', position_name: '   ' },
    ],
  };
  const jobs = mod.parseManatalPage(page1, 'acme', 'Acme');
  ok(jobs.length === 2, `parseManatalPage keeps 2 valid rows (got ${jobs.length})`);
  ok(jobs[0].url === 'https://www.careers-page.com/acme/job/W39XV566', 'job url built from slug + hash');
  ok(jobs[0].location === 'New York, New York, United States, Remote', 'remote flag appended to location');
  ok(jobs[0].description === 'Role\nSell & grow.', `html stripped + entities decoded (got ${JSON.stringify(jobs[0].description)})`);
  ok(jobs[1].location === 'Berlin, Germany' && !('description' in jobs[1]), 'location falls back to city/country; empty description omitted');
  ok(!jobs.some(j => j.title === 'No hash') && !jobs.some(j => j.title.trim() === ''), 'hashless / titleless rows dropped');
  ok(mod.parseManatalPage(null, 'a', 'A').length === 0 && mod.parseManatalPage({ results: 'x' }, 'a', 'A').length === 0, 'malformed payload -> []');
  ok(mod.isTrustedNext('https://open.api.manatal.com/open/v3/career-page/a/jobs/?page=2') === true, 'isTrustedNext accepts API host');
  ok(mod.isTrustedNext('https://evil.example/open/v3/career-page/a/jobs/') === false, 'isTrustedNext (control) rejects other host');
  ok(mod.isTrustedNext('http://open.api.manatal.com/open/v3/career-page/a/') === false, 'isTrustedNext rejects http');

  // fetch: two pages, redirect:'error', pacing, stop when next is null
  const calls = [];
  const sleeps = [];
  const page2 = { count: 3, next: null, results: [{ hash: 'P2', position_name: 'Page two job', description: '' }] };
  const ctx = {
    sleep: async ms => { sleeps.push(ms); },
    fetchJson: async (url, opts) => { calls.push({ url, opts }); return calls.length === 1 ? page1 : page2; },
  };
  const entry = { name: 'Acme', careers_url: 'https://www.careers-page.com/acme' };
  const all = await p.fetch(entry, ctx);
  ok(calls.length === 2 && calls[0].url === 'https://open.api.manatal.com/open/v3/career-page/acme/jobs/' && calls[1].url.endsWith('?page=2'), 'fetch walks next link then stops on next:null');
  ok(calls.every(c => c.opts?.redirect === 'error'), "every request passes redirect:'error'");
  ok(all.length === 3 && all.every(j => j.company === 'Acme'), 'fetch returns 3 jobs with entry.name as company');
  ok(sleeps.length === 1, 'sleeps once between two pages');

  // feed can repeat a posting across pages -> deduped on url
  const dupCtx = { sleep: async () => {}, fetchJson: async () => ({ next: null, results: [{ hash: 'D1', position_name: 'Dup' }, { hash: 'D1', position_name: 'Dup' }] }) };
  ok((await p.fetch(entry, dupCtx)).length === 1, 'duplicate hash within a feed collapsed to one job');

  // maxPages honoured (control: without it two pages are fetched)
  calls.length = 0;
  const one = await p.fetch(entry, { ...ctx, maxPages: 1 });
  ok(calls.length === 1 && one.length === 2, 'ctx.maxPages=1 stops after first page');

  // SSRF: hostile careers_url + hostile next link
  let threw = false;
  try { await p.fetch({ name: 'E', careers_url: 'https://evil.example/x' }, ctx); } catch { threw = true; }
  ok(threw, 'fetch rejects hostile careers_url');
  calls.length = 0;
  let threw2 = '';
  try {
    await p.fetch(entry, { sleep: async () => {}, fetchJson: async url => { calls.push(url); return { next: 'https://evil.example/steal', results: [] }; } });
  } catch (e) { threw2 = e.message; }
  ok(/untrusted/.test(threw2) && calls.length === 1, `fetch refuses off-host next link without requesting it (${threw2})`);
} catch (e) {
  fail(`manatal provider tests crashed: ${e.message}`);
}
