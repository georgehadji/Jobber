// tests/providers/hrmdirect.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — hrmdirect');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

// Row markup copied from the live https://sundance.hrmdirect.com listing (2026-10-21):
// note the real page leaves <a> unclosed before </td>. Extra rows exercise the drops.
const LISTING = `
<table><tr><td class="reqhead">Title</td></tr>
<tr class="reqitem ReqRowClick" data-req-id="3809995" onClick='window.location="job-opening.php?req=3809995&req_loc=1465864&#job ";'>
<td class="leftBorder">&nbsp;</td><td class="custSort1 reqitem">Year-round&nbsp;</td>
<td id='posTitle0' class="posTitle reqitem ReqRowClick"><a href="job-opening.php?req=3809995&req_loc=1465864&&amp;#job">Senior Account Executive, Corporate Partnerships</td>
<td id='cities0' class="cities reqitem">Los Angeles</td>
<td id='state0' class="state reqitem">CA</td></tr>
<tr class="reqitem1" data-req-id="3825449">
<td class="posTitle reqitem1"><a href="job-opening.php?req=3825449&req_loc=1487374&&amp;#job">Senior Manager &amp; Lead</a></td>
<td class="cities reqitem1"></td><td class="state reqitem1">NY</td></tr>
<tr class="reqitem"><td class="posTitle"><a href="job-opening.php?req=3809995&req_loc=1465864&#job">Duplicate pair</a></td></tr>
<tr class="reqitem"><td class="posTitle"><a href="job-opening.php?req=3809995&req_loc=999">Same req, other location</a></td><td class="cities">Austin</td><td class="state">TX</td></tr>
<tr class="reqitem"><td class="posTitle"><a href="job-opening.php?req=3809995">Filter-form link (no req_loc)</a></td></tr>
<tr class="reqitem"><td class="posTitle"><a href="job-opening.php?req=abc&req_loc=1">Non numeric</a></td></tr>
<tr class="reqitem"><td class="posTitle"><a href="job-opening.php?req=11&req_loc=12"> </a></td></tr>
<tr><td><a href="job-openings.php?sort=sa&search=true">State</a></td></tr>
</table>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/hrmdirect.mjs')).href);
  const hrm = mod.default;
  const { parseHrmDirectListing } = mod;

  check(hrm.id === 'hrmdirect', 'hrmdirect.id is "hrmdirect"');

  const hit = hrm.detect({ name: 'S', careers_url: 'https://sundance.hrmdirect.com/employment/job-openings.php?search=true' });
  check(hit?.url === 'https://sundance.hrmdirect.com/employment/job-openings.php?search=true', `hrmdirect.detect() → tenant all-openings listing (got ${JSON.stringify(hit)})`);
  check(hrm.detect({ name: 'S', careers_url: 'https://sundance.hrmdirect.com/' })?.url?.startsWith('https://sundance.hrmdirect.com/employment/'), 'hrmdirect.detect() accepts the bare tenant host');
  check(hrm.detect({ name: 'S', careers_url: 'https://example.com/careers' }) === null, 'hrmdirect.detect() null for non-HRM host');
  check(hrm.detect({ name: 'S', careers_url: 'http://sundance.hrmdirect.com/' }) === null, 'hrmdirect.detect() null for http scheme');
  check(hrm.detect({ name: 'S', careers_url: 'https://evil-hrmdirect.com/employment/' }) === null, 'hrmdirect.detect() null for lookalike host evil-hrmdirect.com');
  check(hrm.detect({ name: 'S', careers_url: 'https://sundance.hrmdirect.com.evil.example/' }) === null, 'hrmdirect.detect() null for suffix-spoofed host');
  check(hrm.detect({ name: 'S', careers_url: 'https://evil.example/sundance.hrmdirect.com/' }) === null, 'hrmdirect.detect() null for path-spoofed URL');
  check(hrm.detect({ name: 'S', careers_url: 7 }) === null, 'hrmdirect.detect() null for non-string careers_url');

  const rows = parseHrmDirectListing(LISTING, 'https://sundance.hrmdirect.com', 'Sundance');
  check(rows.length === 3, `parseHrmDirectListing keeps 3 rows (dup pair, no req_loc, non-numeric, empty title, nav link dropped); got ${rows.length}: ${JSON.stringify(rows.map((r) => r.url))}`);
  check(rows[0]?.title === 'Senior Account Executive, Corporate Partnerships' && rows[0]?.location === 'Los Angeles, CA' && rows[0]?.company === 'Sundance',
    `parseHrmDirectListing row 0 (unclosed <a> tolerated); got ${JSON.stringify(rows[0])}`);
  check(rows[0]?.url === 'https://sundance.hrmdirect.com/employment/job-opening.php?req=3809995&req_loc=1465864', 'parseHrmDirectListing rebuilds a clean URL (no #job / stray &)');
  check(rows[1]?.title === 'Senior Manager & Lead' && rows[1]?.location === 'NY', `parseHrmDirectListing joins only non-empty city/state (got ${JSON.stringify(rows[1])})`);
  check(rows[2]?.url.endsWith('req=3809995&req_loc=999') && rows[2]?.location === 'Austin, TX', 'parseHrmDirectListing keys on the (req, req_loc) pair — same req at another location is a separate posting');
  check(!rows.some((r) => 'postedAt' in r || 'description' in r), 'parseHrmDirectListing omits postedAt/description (list-only)');
  check(parseHrmDirectListing(null, 'https://x.hrmdirect.com', 'A').length === 0 && parseHrmDirectListing('<p>Select options</p>', 'https://x.hrmdirect.com', 'A').length === 0, 'parseHrmDirectListing non-string / empty-result page → []');

  const calls = [];
  const jobs = await hrm.fetch({ name: 'Sundance', careers_url: 'https://sundance.hrmdirect.com/employment/' }, { fetchText: async (url, opts) => { calls.push({ url, opts }); return LISTING; } });
  check(calls.length === 1 && calls[0].url === 'https://sundance.hrmdirect.com/employment/job-openings.php?search=true' && calls[0].opts?.redirect === 'error', `hrmdirect.fetch() single GET with redirect:'error' (got ${JSON.stringify(calls)})`);
  check(jobs.length === 3 && jobs[0].company === 'Sundance', 'hrmdirect.fetch() returns parsed jobs');

  const hostile = [];
  let threw = false;
  try {
    await hrm.fetch({ name: 'X', careers_url: 'https://evil.example/employment/' }, { fetchText: async (u) => { hostile.push(u); return LISTING; } });
  } catch { threw = true; }
  check(threw && hostile.length === 0, 'hrmdirect.fetch() rejects a hostile careers_url without making a request');
} catch (e) {
  fail(`hrmdirect provider tests crashed: ${e.message}`);
}
