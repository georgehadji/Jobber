// tests/providers/pageup.test.mjs — fixture shaped like live careers.pageuppeople.com/513 search envelope (2026-10-21), trimmed.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — pageup');
const ok = (c, m) => (c ? pass(m) : fail(m));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/pageup.mjs')).href);
  const p = mod.default;
  ok(p.id === 'pageup', 'pageup.id is "pageup"');

  const API = 'https://careers.pageuppeople.com/513/cw/en/search/?page-items=1000';
  ok(p.detect({ name: 'M', careers_url: 'https://careers.pageuppeople.com/513/cw/en/listing/' })?.url === API, 'detect() listing URL -> search API');
  ok(p.detect({ name: 'M', careers_url: 'https://careers.pageuppeople.com/513/cw/en/job/699243/animal-technician' })?.url === API, 'detect() job URL -> search API');
  ok(p.detect({ name: 'M', careers_url: 'http://careers.pageuppeople.com/513/cw/en/listing/' }) === null, 'detect() rejects http');
  ok(p.detect({ name: 'M', careers_url: 'https://evil-careers.pageuppeople.com.example/513/cw/en/listing/' }) === null, 'detect() rejects lookalike host');
  ok(p.detect({ name: 'M', careers_url: 'https://careers.pageuppeople.com.evil.example/513/cw/en/listing/' }) === null, 'detect() rejects suffix-spoofed host');
  ok(p.detect({ name: 'M', careers_url: 'https://evil.example/careers.pageuppeople.com/513/cw/en/listing/' }) === null, 'detect() rejects path-spoofed URL');
  ok(p.detect({ name: 'M', careers_url: 'https://careers.pageuppeople.com/monash/cw/en/listing/' }) === null, 'detect() null for non-numeric institution');
  ok(p.detect({ name: 'M', careers_url: 'https://careers.pageuppeople.com/' }) === null, 'detect() null without institution');

  // <tr> layout, as served live
  const trFragment = ` \r\n    <tr> \r\n      <td> \r\n        <a class="job-link" href="/513/cw/en/job/699243/animal-technician">Animal Technician</a> \r\n      </td> \r\n      <td> \r\n        <span class="location">Clayton campus</span> \r\n      </td>\r\n      <td> HEW 3 ($69,079 - $77,760) </td>\r\n    </tr> \r\n    <tr class="summary"> \r\n      <td colspan="4">Join MARP as an Animal Technician &amp; care for animals.</td> \r\n    </tr> \r\n
    <tr><td><a class="job-link" href="/513/cw/en/job/698867/lecturer-in-applied-mathematics">Lecturer in Applied Mathematics</a></td><td><span class="location">Clayton campus</span></td></tr>
    <tr class="summary"><td colspan="4">Conduct research.</td></tr>
    <tr><td><a class="job-link" href="/513/cw/en/job/699580/student-support-officer">Student Support Officer</a></td><td><span class="location">Caulfield</span></td></tr>`;
  const jobs = mod.parsePageUpListing(trFragment, '513', 'Monash');
  ok(jobs.length === 3, `parsePageUpListing <tr> layout -> 3 jobs (got ${jobs.length})`);
  ok(jobs[0].title === 'Animal Technician' && jobs[0].url === 'https://careers.pageuppeople.com/513/cw/en/job/699243/animal-technician', 'title + absolute url');
  ok(jobs[0].location === 'Clayton campus' && jobs[0].company === 'Monash', 'location + company');
  ok(jobs[0].description === 'Join MARP as an Animal Technician & care for animals.', 'summary row -> description (entities decoded)');
  ok(jobs[1].description === 'Conduct research.' && jobs[1].location === 'Clayton campus', 'second job gets its own summary, not the first');
  ok(jobs[2].location === 'Caulfield' && !('description' in jobs[2]), 'last job without summary has none (no leakage from previous)');

  // <li> layout + nav link + duplicate + foreign-institution link
  const liFragment = `<a class="job-link" href="/513/cw/en/listing/">Back to listing</a>
    <ul><li><a class="job-link" href="/513/cw/en/job/1/one">One</a><span class="location">Perth</span><div class="summary">First teaser</div></li>
    <li><a class="job-link" href="/513/cw/en/job/1/one">One again</a></li>
    <li><a class="job-link" href="/999/cw/en/job/2/other-tenant">Other tenant</a></li>
    <li><a class="job-link" href="/513/cw/en/job/3/three">  </a></li></ul>`;
  const li = mod.parsePageUpListing(liFragment, '513', 'X');
  ok(li.length === 1 && li[0].title === 'One' && li[0].location === 'Perth' && li[0].description === 'First teaser', 'li layout: nav/dup/foreign-tenant/blank-title rows dropped');
  ok(mod.parsePageUpListing('', '513', 'X').length === 0 && mod.parsePageUpListing(null, '513', 'X').length === 0, 'empty / null fragment -> []');

  const calls = [];
  const ctx = { fetchJson: async (url, opts) => { calls.push({ url, opts }); return { results: trFragment, count: 3 }; } };
  const fetched = await p.fetch({ name: 'Monash', careers_url: 'https://careers.pageuppeople.com/513/cw/en/listing/' }, ctx);
  ok(calls.length === 1 && calls[0].url === API, 'fetch makes one search request');
  ok(calls[0].opts?.redirect === 'error', "fetch passes redirect:'error'");
  ok(calls[0].opts?.headers?.['X-Requested-With'] === 'XMLHttpRequest', 'fetch sends the XHR header the endpoint requires');
  ok(fetched.length === 3, 'fetch returns parsed jobs');
  const none = await p.fetch({ name: 'Monash', careers_url: 'https://careers.pageuppeople.com/513/' }, { fetchJson: async () => ({ results: 5 }) });
  ok(none.length === 0, 'non-string results -> []');

  let threw = false;
  try { await p.fetch({ name: 'E', careers_url: 'https://evil.example/513/cw/en/listing/' }, ctx); } catch { threw = true; }
  ok(threw && calls.length === 1, 'fetch rejects hostile careers_url without any request');
} catch (e) {
  fail(`pageup provider tests crashed: ${e.message}`);
}
