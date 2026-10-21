// tests/providers/jazzhr.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jazzhr');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

// Trimmed from the live https://proautomated.applytojob.com/apply listing (2026-10-21),
// plus a duplicate token, an off-host anchor, an empty-title anchor, and a non-job anchor.
const LISTING = `
<ul class='list-group'>
 <li class="list-group-item">
  <h3 class='list-group-item-heading'>
   <a href="https://acme.applytojob.com/apply/gXEZwLr7OQ/Field-Service-Engineer">
     Field Service Engineer &amp; Installer   </a>
  </h3>
  <ul class='list-inline list-group-item-text'>
   <li><i class='fa fa-map-marker'></i>Westminster, CO</li>
  </ul>
 </li>
 <li class="list-group-item">
  <h3 class='list-group-item-heading'>
   <a href="/apply/ekmawWSaxl/Sales-Rep">Sales Rep</a>
  </h3>
  <ul class='list-inline list-group-item-text'><li><i class='fa fa-sitemap'></i>Sales</li></ul>
 </li>
 <li class="list-group-item">
  <h3 class='list-group-item-heading'><a href="https://acme.applytojob.com/apply/gXEZwLr7OQ/Dup">Duplicate token</a></h3>
 </li>
 <li class="list-group-item">
  <h3 class='list-group-item-heading'><a href="https://evil.example/apply/EVIL000001/Role">Off host</a></h3>
 </li>
 <li class="list-group-item">
  <h3 class='list-group-item-heading'><a href="https://acme.applytojob.com/apply/EMPTY00001/Role">   </a></h3>
 </li>
 <li><a href="https://acme.applytojob.com/about">About us</a></li>
</ul>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/jazzhr.mjs')).href);
  const jazzhr = mod.default;
  const { parseJazzHRListing } = mod;

  check(jazzhr.id === 'jazzhr', 'jazzhr.id is "jazzhr"');

  // detect
  const hit = jazzhr.detect({ name: 'Acme', careers_url: 'https://acme.applytojob.com/apply' });
  check(hit?.url === 'https://acme.applytojob.com/apply', `jazzhr.detect() resolves <tenant>.applytojob.com → /apply (got ${JSON.stringify(hit)})`);
  check(jazzhr.detect({ name: 'A', careers_url: 'https://acme.applytojob.com/apply/gXEZwLr7OQ/Role' })?.url === 'https://acme.applytojob.com/apply', 'jazzhr.detect() accepts a job-page URL and returns the tenant listing');
  check(jazzhr.detect({ name: 'A', careers_url: 'https://example.com/careers' }) === null, 'jazzhr.detect() null for non-JazzHR host');
  check(jazzhr.detect({ name: 'A', careers_url: 'http://acme.applytojob.com/apply' }) === null, 'jazzhr.detect() null for http scheme');
  check(jazzhr.detect({ name: 'A', careers_url: 'https://evil-applytojob.com/apply' }) === null, 'jazzhr.detect() null for lookalike host evil-applytojob.com');
  check(jazzhr.detect({ name: 'A', careers_url: 'https://acme.applytojob.com.evil.example/apply' }) === null, 'jazzhr.detect() null for suffix-spoofed host');
  check(jazzhr.detect({ name: 'A', careers_url: 'https://evil.example/acme.applytojob.com/apply' }) === null, 'jazzhr.detect() null for path-spoofed URL');
  check(jazzhr.detect({ name: 'A', careers_url: null }) === null && jazzhr.detect({ name: 'A', careers_url: 7 }) === null, 'jazzhr.detect() null for non-string careers_url');

  // parser
  const rows = parseJazzHRListing(LISTING, 'https://acme.applytojob.com', 'Acme');
  check(rows.length === 2, `parseJazzHRListing keeps 2 rows (dup token, off-host, empty-title, non-job dropped); got ${rows.length}: ${JSON.stringify(rows.map((r) => r.title))}`);
  check(rows[0]?.title === 'Field Service Engineer & Installer' && rows[0]?.location === 'Westminster, CO' && rows[0]?.company === 'Acme',
    `parseJazzHRListing row 0 title/location/company (got ${JSON.stringify(rows[0])})`);
  check(rows[0]?.url === 'https://acme.applytojob.com/apply/gXEZwLr7OQ/Field-Service-Engineer', 'parseJazzHRListing keeps the first duplicate-token URL');
  check(rows[1]?.url === 'https://acme.applytojob.com/apply/ekmawWSaxl/Sales-Rep', 'parseJazzHRListing resolves a relative href against the tenant origin');
  check(rows[1]?.location === '', 'parseJazzHRListing leaves location empty when no map-marker item (control: row 0 has one)');
  check(!rows.some((r) => /evil\.example/.test(r.url)), 'parseJazzHRListing drops off-host anchors');
  check(parseJazzHRListing(null, 'https://acme.applytojob.com', 'A').length === 0 && parseJazzHRListing('<html></html>', 'https://acme.applytojob.com', 'A').length === 0, 'parseJazzHRListing non-string / empty page → []');

  // fetch with mock ctx
  const calls = [];
  const ctx = { fetchText: async (url, opts) => { calls.push({ url, opts }); return LISTING; } };
  const jobs = await jazzhr.fetch({ name: 'Acme', careers_url: 'https://acme.applytojob.com/apply' }, ctx);
  check(calls.length === 1 && calls[0].url === 'https://acme.applytojob.com/apply' && calls[0].opts?.redirect === 'error', `jazzhr.fetch() single GET /apply with redirect:'error' (got ${JSON.stringify(calls)})`);
  check(jobs.length === 2, 'jazzhr.fetch() returns parsed jobs');

  // SSRF: hostile careers_url never reaches the transport
  const hostile = [];
  let threw = false;
  try {
    await jazzhr.fetch({ name: 'X', careers_url: 'https://evil.example/apply' }, { fetchText: async (u) => { hostile.push(u); return ''; } });
  } catch { threw = true; }
  check(threw && hostile.length === 0, 'jazzhr.fetch() rejects a hostile careers_url without making a request');
} catch (e) {
  fail(`jazzhr provider tests crashed: ${e.message}`);
}
