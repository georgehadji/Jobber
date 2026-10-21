// tests/providers/careerplug.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — careerplug');

const row = (id, name, loc, date) =>
  `<div style="x"><a aria-label="${name}" href="/jobs/${id}"><div class="row"><div class="job-title col-sm-7"><span class="name">${name}</span></div>` +
  `<div class="job-location col-md-3">\n <div>\n <span class='job-row-title hidden-md hidden-lg'>Location:</span>\n ${loc}\n </div>\n </div>` +
  `<div class="job-post-date col-md-2"><div><span class='job-row-title'>Post Date:</span> ${date}</div></div></div></a></div>`;
const PAGE1 = `<html><div id="job_table">${row(937981, 'Line Cook &amp; Prep', 'AK-Anchorage-99503', '10-20-26')}${row(938369, 'Baker', 'WI-Oshkosh', '13-45-26')}<a href="/jobs?page=2">next</a><a href="/jobs/777"><div class="row"></div></a></div></html>`;
const PAGE2 = `<html>${row(3498325, 'Cashier', 'VA-Bristol', '10-19-26')}${row(937981, 'Line Cook &amp; Prep', 'AK-Anchorage-99503', '10-20-26')}</html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/careerplug.mjs')).href);
  const cp = mod.default;
  const { parseCareerPlugListing } = mod;

  if (cp.id === 'careerplug') pass('careerplug.id is "careerplug"'); else fail(`careerplug.id is ${cp.id}`);

  // detect: positive
  const hit = cp.detect({ name: 'GC', careers_url: 'https://golden-corral-careers.careerplug.com/jobs' });
  if (hit?.url === 'https://golden-corral-careers.careerplug.com/jobs') pass('careerplug.detect() claims <board>.careerplug.com');
  else fail(`careerplug.detect() positive returned ${JSON.stringify(hit)}`);
  // detect: negatives (each distinct reason)
  for (const [label, u] of [
    ['wrong host', 'https://example.com/jobs'],
    ['http scheme', 'http://acme.careerplug.com/jobs'],
    ['lookalike host', 'https://evil-careerplug.com/jobs'],
    ['suffix lookalike', 'https://acme.careerplug.com.evil.example/jobs'],
    ['path spoof', 'https://evil.example/acme.careerplug.com/jobs'],
    ['bare apex', 'https://careerplug.com/jobs'],
  ]) {
    if (cp.detect({ name: 'X', careers_url: u }) === null) pass(`careerplug.detect() rejects ${label}`);
    else fail(`careerplug.detect() must reject ${label}: ${u}`);
  }
  if (cp.detect({ name: 'X', careers_url: 7 }) === null && cp.detect({ name: 'X' }) === null) pass('careerplug.detect() null for non-string/missing careers_url');
  else fail('careerplug.detect() non-string careers_url');

  // parser: identity, not count
  const rows = parseCareerPlugListing(PAGE1, 'https://acme.careerplug.com', 'Acme');
  const byId = Object.fromEntries(rows.map((r) => [r.url, r]));
  const j1 = byId['https://acme.careerplug.com/jobs/937981'];
  if (j1 && j1.title === 'Line Cook & Prep' && j1.location === 'AK-Anchorage-99503' && j1.company === 'Acme' && j1.postedAt === Date.UTC(2026, 9, 20)) {
    pass('parseCareerPlugListing maps title (entity-decoded), location, company, postedAt');
  } else fail(`parseCareerPlugListing job1 = ${JSON.stringify(j1)}`);
  const j2 = byId['https://acme.careerplug.com/jobs/938369'];
  if (j2 && j2.title === 'Baker' && !('postedAt' in j2)) pass('parseCareerPlugListing omits postedAt for an unparseable date');
  else fail(`parseCareerPlugListing job2 = ${JSON.stringify(j2)}`);
  if (!byId['https://acme.careerplug.com/jobs/777'] && rows.length === 2) pass('parseCareerPlugListing drops anchors without a title');
  else fail(`parseCareerPlugListing kept untitled anchor: ${JSON.stringify(rows.map((r) => r.url))}`);
  if (parseCareerPlugListing(null, 'https://a.careerplug.com', 'A').length === 0 && parseCareerPlugListing('', 'https://a.careerplug.com', 'A').length === 0) pass('parseCareerPlugListing non-string/empty → []');
  else fail('parseCareerPlugListing should return [] for null/empty');

  // fetch: URLs, opts, pagination, dedup
  const calls = [];
  const sleeps = [];
  const mk = (pages, extra = {}) => ({
    transport: 'http',
    fetchText: async (url, opts) => { calls.push({ url, opts }); return pages[calls.length - 1] ?? '<html></html>'; },
    sleep: async (ms) => { sleeps.push(ms); },
    ...extra,
  });
  const entry = { name: 'Acme', careers_url: 'https://acme.careerplug.com/jobs' };
  const jobs = await cp.fetch(entry, mk([PAGE1, PAGE2, '<html>empty</html>', PAGE1]));
  const urls = calls.map((c) => c.url);
  if (urls.join('|') === 'https://acme.careerplug.com/jobs|https://acme.careerplug.com/jobs?page=2|https://acme.careerplug.com/jobs?page=3') pass('careerplug.fetch() pages /jobs, ?page=2, ?page=3 and stops on the empty page');
  else fail(`careerplug.fetch() requested ${JSON.stringify(urls)}`);
  if (calls.every((c) => c.opts?.redirect === 'error')) pass('careerplug.fetch() passes redirect:error on every request');
  else fail('careerplug.fetch() missing redirect:error');
  const gotUrls = jobs.map((j) => j.url).sort();
  const want = ['938369', '937981', '3498325'].map((i) => `https://acme.careerplug.com/jobs/${i}`).sort();
  if (JSON.stringify(gotUrls) === JSON.stringify(want)) pass('careerplug.fetch() merges pages and dedups a job repeated on page 2');
  else fail(`careerplug.fetch() urls = ${JSON.stringify(gotUrls)}`);
  if (sleeps.length === 2) pass('careerplug.fetch() paces between pages via ctx.sleep'); else fail(`careerplug.fetch() sleeps = ${sleeps.length}`);

  // maxPages honoured; repeated last page terminates
  calls.length = 0;
  await cp.fetch(entry, mk([PAGE1, PAGE2, PAGE2.replace('Cashier', 'Cashier2')], { maxPages: 1 }));
  if (calls.length === 1) pass('careerplug.fetch() honours ctx.maxPages=1'); else fail(`careerplug.fetch() maxPages=1 made ${calls.length} calls`);
  calls.length = 0;
  await cp.fetch(entry, mk([PAGE1, PAGE1, PAGE1, PAGE1]));
  if (calls.length === 2) pass('careerplug.fetch() stops when a page adds no new jobs'); else fail(`careerplug.fetch() repeat-page made ${calls.length} calls`);
  calls.length = 0;
  await cp.fetch(entry, mk(Array.from({ length: 30 }, (_, i) => row(100 + i, `Job${i}`, 'X', '10-20-26'))));
  if (calls.length === 5) pass('careerplug.fetch() defaults to a 5-page cap'); else fail(`careerplug.fetch() default cap made ${calls.length} calls`);

  // SSRF: hostile careers_url never fetches
  calls.length = 0;
  let threw = false;
  try { await cp.fetch({ name: 'Evil', careers_url: 'https://evil.example/jobs' }, mk([PAGE1])); } catch { threw = true; }
  if (threw && calls.length === 0) pass('careerplug.fetch() rejects a hostile careers_url without any request');
  else fail(`careerplug.fetch() hostile url threw=${threw} calls=${calls.length}`);
} catch (e) {
  fail(`careerplug provider tests crashed: ${e.message}`);
}
