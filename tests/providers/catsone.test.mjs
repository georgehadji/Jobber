// tests/providers/catsone.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — catsone');

const row = (href, title, loc) =>
  `<a class="table-row" href="${href}" data-discover="true"><div class="data-cell title-cell">${title}</div>` +
  `<div class="data-cell" data-label="Category"></div><div class="data-cell" data-label="Location">${loc}</div></a>`;
const PAGE = `<html><div class="grid-table"><div class="table-header"><div class="header-cell">Job Title</div></div>` +
  row('/careers/90438/jobs/16865408-Senior-Duck-Creek-Engineer', 'Senior Duck Creek Engineer (Policy &amp; Rating)', 'India, Remotely') +
  row('/careers/90438/jobs/16860942-System-Engineer-Linux', 'System Engineer (Linux)', 'Anywhere &amp; Remote') +
  row('/careers/90438/jobs/16860942-System-Engineer-Linux', 'Duplicate', 'Nowhere') +
  row('/careers/11111/jobs/222-Other-Portal', 'Other portal job', 'X') +
  row('/careers/90438/jobs/333-No-Title', ' ', 'X') +
  row('/careers/90438/register', 'Register', 'X') +
  `<a class="plain" href="/careers/90438/jobs/444-not-a-row"><div class="title-cell">Not a row</div></a></div></html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/catsone.mjs')).href);
  const cats = mod.default;
  const { parseCatsListing } = mod;

  if (cats.id === 'catsone') pass('catsone.id is "catsone"'); else fail(`catsone.id is ${cats.id}`);

  const hit = cats.detect({ name: 'S', careers_url: 'https://sphereinc.catsone.com/careers/90438/jobs/16831828-sdr' });
  if (hit?.url === 'https://sphereinc.catsone.com/careers/90438') pass('catsone.detect() claims <tenant>.catsone.com/careers/<portalId>'); else fail(`catsone.detect() returned ${JSON.stringify(hit)}`);
  for (const [label, u] of [
    ['wrong host', 'https://example.com/careers/1'],
    ['http scheme', 'http://acme.catsone.com/careers/1'],
    ['lookalike host', 'https://evil-catsone.com/careers/1'],
    ['suffix lookalike', 'https://acme.catsone.com.evil.example/careers/1'],
    ['path spoof', 'https://evil.example/acme.catsone.com/careers/1'],
    ['bare apex', 'https://catsone.com/careers/1'],
    ['no portal id (307 redirect would be needed)', 'https://acme.catsone.com/careers'],
    ['non-numeric portal id', 'https://acme.catsone.com/careers/abc'],
  ]) {
    if (cats.detect({ name: 'X', careers_url: u }) === null) pass(`catsone.detect() rejects ${label}`);
    else fail(`catsone.detect() must reject ${label}: ${u}`);
  }
  if (cats.detect({ name: 'X', careers_url: 7 }) === null && cats.detect({ name: 'X' }) === null) pass('catsone.detect() null for non-string/missing careers_url');
  else fail('catsone.detect() non-string careers_url');

  const rows = parseCatsListing(PAGE, 'https://acme.catsone.com', '90438', 'Acme');
  const a = rows.find((r) => r.url === 'https://acme.catsone.com/careers/90438/jobs/16865408-Senior-Duck-Creek-Engineer');
  const b = rows.find((r) => r.url === 'https://acme.catsone.com/careers/90438/jobs/16860942-System-Engineer-Linux');
  if (a && a.title === 'Senior Duck Creek Engineer (Policy & Rating)' && a.location === 'India, Remotely' && a.company === 'Acme') pass('parseCatsListing maps title (decoded), location, company, absolute URL');
  else fail(`parseCatsListing job a = ${JSON.stringify(a)}`);
  if (b && b.title === 'System Engineer (Linux)' && b.location === 'Anywhere & Remote') pass('parseCatsListing decodes location entities and keeps the first of a duplicated id'); else fail(`parseCatsListing job b = ${JSON.stringify(b)}`);
  if (rows.length === 2) pass('parseCatsListing drops other-portal, untitled, non-job and non-table-row anchors'); else fail(`parseCatsListing kept ${JSON.stringify(rows.map((r) => r.url))}`);
  if (parseCatsListing(null, 'https://a.catsone.com', '1', 'A').length === 0 && parseCatsListing('', 'https://a.catsone.com', '1', 'A').length === 0) pass('parseCatsListing non-string/empty → []'); else fail('parseCatsListing should return [] for null/empty');

  const calls = [];
  const ctx = { transport: 'http', fetchText: async (url, opts) => { calls.push({ url, opts }); return PAGE; } };
  const jobs = await cats.fetch({ name: 'Acme', careers_url: 'https://acme.catsone.com/careers/90438' }, ctx);
  if (calls.length === 1 && calls[0].url === 'https://acme.catsone.com/careers/90438' && calls[0].opts?.redirect === 'error' && jobs.length === 2) pass('catsone.fetch() makes one redirect:error request to the portal and returns jobs');
  else fail(`catsone.fetch() calls=${JSON.stringify(calls)} jobs=${jobs.length}`);

  for (const u of ['https://evil.example/careers/90438', 'https://acme.catsone.com/careers']) {
    calls.length = 0;
    let threw = false;
    try { await cats.fetch({ name: 'Evil', careers_url: u }, ctx); } catch { threw = true; }
    if (threw && calls.length === 0) pass(`catsone.fetch() refuses ${u} without any request`);
    else fail(`catsone.fetch() ${u} threw=${threw} calls=${calls.length}`);
  }
} catch (e) {
  fail(`catsone provider tests crashed: ${e.message}`);
}
