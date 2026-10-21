// tests/providers/freshteam.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — freshteam');

const card = (id, slug, title, loc, remote) =>
  `<a href="/jobs/${id}/${slug}" class="heading" data-portal-title="x" data-portal-location="${loc}" data-portal-job-type="2" data-portal-remote-location=${remote}>` +
  `<div class="row"><div class="job-list-info"><div class="job-title">${title}</div><div class="job-desc text">Snippet...</div></div></div></a>`;
const ID_A = 'w0GYuu_wvon4';
const ID_B = 'KopZBCpdWlrb';
const ID_C = 'UqanwI5TZX9y';
const PAGE1 = `<html><div class="job-list">${card(ID_A, 'digital-marketing', 'Digital Marketing &amp; SEO', 'San Francisco, United States', 'true')}${card(ID_B, 'dm-ae', 'Account Exec', 'Berlin &amp; Bonn', 'false')}` +
  `<a href="/jobs/search" class="x"><div class="job-title">Search</div></a>` +
  `<a href="/jobs/short/slug" class="x"><div class="job-title">Bad id</div></a>` +
  card('AAAAAAAAAAAA', 'no-title', ' ', 'X', 'false') + `</div></html>`;
const PAGE2 = `<html>${card(ID_C, 'dm-af', 'Analyst', 'Paris', 'false')}${card(ID_A, 'digital-marketing', 'Digital Marketing &amp; SEO', 'San Francisco, United States', 'true')}</html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/freshteam.mjs')).href);
  const ft = mod.default;
  const { parseFreshteamListing } = mod;

  if (ft.id === 'freshteam') pass('freshteam.id is "freshteam"'); else fail(`freshteam.id is ${ft.id}`);

  const hit = ft.detect({ name: 'S', careers_url: 'https://simera-talent.freshteam.com/jobs' });
  if (hit?.url === 'https://simera-talent.freshteam.com/jobs') pass('freshteam.detect() claims <tenant>.freshteam.com'); else fail(`freshteam.detect() returned ${JSON.stringify(hit)}`);
  for (const [label, u] of [
    ['wrong host', 'https://example.com/jobs'],
    ['http scheme', 'http://acme.freshteam.com/jobs'],
    ['lookalike host', 'https://evil-freshteam.com/jobs'],
    ['suffix lookalike', 'https://acme.freshteam.com.evil.example/jobs'],
    ['path spoof', 'https://evil.example/acme.freshteam.com/jobs'],
    ['bare apex', 'https://freshteam.com/jobs'],
  ]) {
    if (ft.detect({ name: 'X', careers_url: u }) === null) pass(`freshteam.detect() rejects ${label}`);
    else fail(`freshteam.detect() must reject ${label}: ${u}`);
  }
  if (ft.detect({ name: 'X', careers_url: 7 }) === null && ft.detect({ name: 'X' }) === null) pass('freshteam.detect() null for non-string/missing careers_url');
  else fail('freshteam.detect() non-string careers_url');

  const rows = parseFreshteamListing(PAGE1, 'https://acme.freshteam.com', 'Acme');
  const a = rows.find((r) => r.url === `https://acme.freshteam.com/jobs/${ID_A}`);
  const b = rows.find((r) => r.url === `https://acme.freshteam.com/jobs/${ID_B}`);
  if (a && a.title === 'Digital Marketing & SEO' && a.location === 'San Francisco, United States, Remote' && a.company === 'Acme') pass('parseFreshteamListing maps title (decoded), location + Remote flag, company');
  else fail(`parseFreshteamListing job a = ${JSON.stringify(a)}`);
  if (b && b.location === 'Berlin & Bonn') pass('parseFreshteamListing decodes entities and omits Remote when false'); else fail(`parseFreshteamListing job b = ${JSON.stringify(b)}`);
  if (rows.length === 2) pass('parseFreshteamListing drops /jobs/search, short-id and untitled anchors'); else fail(`parseFreshteamListing kept ${JSON.stringify(rows.map((r) => r.url))}`);
  if (parseFreshteamListing(null, 'https://a.freshteam.com', 'A').length === 0 && parseFreshteamListing('', 'https://a.freshteam.com', 'A').length === 0) pass('parseFreshteamListing non-string/empty → []');
  else fail('parseFreshteamListing should return [] for null/empty');

  const calls = [];
  const sleeps = [];
  const mk = (pages, extra = {}) => ({
    transport: 'http',
    fetchText: async (url, opts) => { calls.push({ url, opts }); return pages[calls.length - 1] ?? '<html></html>'; },
    sleep: async (ms) => { sleeps.push(ms); },
    ...extra,
  });
  const entry = { name: 'Acme', careers_url: 'https://acme.freshteam.com/jobs' };
  const jobs = await ft.fetch(entry, mk([PAGE1, PAGE2, '<html>empty</html>', PAGE1]));
  const urls = calls.map((c) => c.url);
  if (urls.join('|') === 'https://acme.freshteam.com/jobs?page=1|https://acme.freshteam.com/jobs?page=2|https://acme.freshteam.com/jobs?page=3') pass('freshteam.fetch() pages ?page=1..3 and stops on the empty page');
  else fail(`freshteam.fetch() requested ${JSON.stringify(urls)}`);
  if (calls.every((c) => c.opts?.redirect === 'error')) pass('freshteam.fetch() passes redirect:error on every request'); else fail('freshteam.fetch() missing redirect:error');
  const got = jobs.map((j) => j.url).sort();
  const want = [ID_A, ID_B, ID_C].map((i) => `https://acme.freshteam.com/jobs/${i}`).sort();
  if (JSON.stringify(got) === JSON.stringify(want)) pass('freshteam.fetch() merges pages and dedups a job repeated on page 2'); else fail(`freshteam.fetch() urls = ${JSON.stringify(got)}`);
  if (sleeps.length === 2) pass('freshteam.fetch() paces between pages via ctx.sleep'); else fail(`freshteam.fetch() sleeps = ${sleeps.length}`);

  calls.length = 0;
  await ft.fetch(entry, mk([PAGE1, PAGE2], { maxPages: 1 }));
  if (calls.length === 1) pass('freshteam.fetch() honours ctx.maxPages=1'); else fail(`freshteam.fetch() maxPages=1 made ${calls.length} calls`);
  calls.length = 0;
  await ft.fetch(entry, mk([PAGE1, PAGE1, PAGE1]));
  if (calls.length === 2) pass('freshteam.fetch() stops when a page adds no new jobs'); else fail(`freshteam.fetch() repeat-page made ${calls.length} calls`);
  calls.length = 0;
  await ft.fetch(entry, mk(Array.from({ length: 30 }, (_, i) => card(`${String(i).padStart(12, 'Z')}`, 's', `J${i}`, 'X', 'false'))));
  if (calls.length === 5) pass('freshteam.fetch() defaults to a 5-page cap'); else fail(`freshteam.fetch() default cap made ${calls.length} calls`);

  calls.length = 0;
  let threw = false;
  try { await ft.fetch({ name: 'Evil', careers_url: 'https://evil.example/jobs' }, mk([PAGE1])); } catch { threw = true; }
  if (threw && calls.length === 0) pass('freshteam.fetch() rejects a hostile careers_url without any request');
  else fail(`freshteam.fetch() hostile url threw=${threw} calls=${calls.length}`);
} catch (e) {
  fail(`freshteam provider tests crashed: ${e.message}`);
}
