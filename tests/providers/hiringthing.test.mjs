// tests/providers/hiringthing.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — hiringthing');

const card = (id, slug, title, loc) =>
  `<div class="job-container" data-job-id="${id}" data-testid="careers-job-${id}"><div class="job-content-header"><div class="job-headline">` +
  `<div class="job-title-and-category"><a class="mobile-apply-link" href="/job/${id}/${slug}"><h2>${title}</h2></a></div>` +
  `<div class="job-location-and-category"><div class="job-location">\n\t${loc}\n</div></div></div>` +
  `<a href="/job/${id}/${slug}"><div class="job-content-button">Learn more</div></a></div><div class="job-description">Snippet…</div></div>`;
const PAGE = `<html><div data-react-class="HiringThing.Components.JobFiltersContainer"></div><div class="jobs-list-container">` +
  card(793231, 'nbs-hakuba-instructor', 'NBS Hakuba Instructor &amp; Coach', 'Hakuba, Nagano') +
  card(71164, 'niseko-supervisor', 'Niseko Supervisor', 'Niseko, Hokkaido') +
  card(793231, 'dup-slug', 'Duplicate', 'Nowhere') +
  `<div class="job-container" data-job-id="x"><a href="/privacy"><h2>Not a job</h2></a></div>` +
  `<div class="job-container" data-job-id="9"><a href="/job/9/untitled"><h2> </h2></a></div></div></html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/hiringthing.mjs')).href);
  const ht = mod.default;
  const { parseHiringThingListing } = mod;

  if (ht.id === 'hiringthing') pass('hiringthing.id is "hiringthing"'); else fail(`hiringthing.id is ${ht.id}`);

  const hit = ht.detect({ name: 'SJ', careers_url: 'https://skijapan.hiringthing.com/jobs' });
  if (hit?.url === 'https://skijapan.hiringthing.com/') pass('hiringthing.detect() claims <tenant>.hiringthing.com'); else fail(`hiringthing.detect() returned ${JSON.stringify(hit)}`);
  for (const [label, u] of [
    ['wrong host', 'https://example.com/jobs'],
    ['http scheme', 'http://skijapan.hiringthing.com/'],
    ['lookalike host', 'https://evil-hiringthing.com/'],
    ['suffix lookalike', 'https://skijapan.hiringthing.com.evil.example/'],
    ['path spoof', 'https://evil.example/skijapan.hiringthing.com/'],
    ['bare apex', 'https://hiringthing.com/'],
  ]) {
    if (ht.detect({ name: 'X', careers_url: u }) === null) pass(`hiringthing.detect() rejects ${label}`);
    else fail(`hiringthing.detect() must reject ${label}: ${u}`);
  }
  if (ht.detect({ name: 'X', careers_url: 7 }) === null && ht.detect({ name: 'X' }) === null) pass('hiringthing.detect() null for non-string/missing careers_url');
  else fail('hiringthing.detect() non-string careers_url');

  const rows = parseHiringThingListing(PAGE, 'https://skijapan.hiringthing.com', 'Ski Japan');
  const a = rows.find((r) => r.url === 'https://skijapan.hiringthing.com/job/793231');
  const b = rows.find((r) => r.url === 'https://skijapan.hiringthing.com/job/71164');
  if (a && a.title === 'NBS Hakuba Instructor & Coach' && a.location === 'Hakuba, Nagano' && a.company === 'Ski Japan') pass('parseHiringThingListing maps title (decoded), location, company, canonical URL');
  else fail(`parseHiringThingListing job a = ${JSON.stringify(a)}`);
  if (b && b.title === 'Niseko Supervisor') pass('parseHiringThingListing second posting parsed'); else fail(`parseHiringThingListing job b = ${JSON.stringify(b)}`);
  if (rows.length === 2 && !rows.some((r) => r.title === 'Duplicate' || r.title === 'Not a job')) pass('parseHiringThingListing dedups by id and drops non-job/untitled cards');
  else fail(`parseHiringThingListing rows = ${JSON.stringify(rows.map((r) => r.title))}`);
  if (parseHiringThingListing(null, 'https://a.hiringthing.com', 'A').length === 0 && parseHiringThingListing('<html></html>', 'https://a.hiringthing.com', 'A').length === 0) pass('parseHiringThingListing non-string/empty → []');
  else fail('parseHiringThingListing should return [] for null/empty');

  const calls = [];
  const ctx = { transport: 'http', fetchText: async (url, opts) => { calls.push({ url, opts }); return PAGE; } };
  const jobs = await ht.fetch({ name: 'Ski Japan', careers_url: 'https://skijapan.hiringthing.com/jobs' }, ctx);
  if (calls.length === 1 && calls[0].url === 'https://skijapan.hiringthing.com/' && calls[0].opts?.redirect === 'error' && jobs.length === 2) pass('hiringthing.fetch() makes one redirect:error request to the root and returns jobs');
  else fail(`hiringthing.fetch() calls=${JSON.stringify(calls)} jobs=${jobs.length}`);

  calls.length = 0;
  let threw = false;
  try { await ht.fetch({ name: 'Evil', careers_url: 'https://evil.example/' }, ctx); } catch { threw = true; }
  if (threw && calls.length === 0) pass('hiringthing.fetch() rejects a hostile careers_url without any request');
  else fail(`hiringthing.fetch() hostile url threw=${threw} calls=${calls.length}`);
} catch (e) {
  fail(`hiringthing provider tests crashed: ${e.message}`);
}
