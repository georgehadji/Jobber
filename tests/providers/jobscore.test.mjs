// tests/providers/jobscore.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jobscore');

// Shaped like the live feed.json (trimmed).
const FEED = {
  company_name: 'IERUS Technologies, Inc.',
  company_code: 'ierus',
  jobs: [
    {
      id: 'cqkqP_HXDgDPfxnVVQNgaB', title: 'COMSEC Systems Engineer ',
      detail_url: 'https://careers.jobscore.com/careers/ierus/jobs/comsec-systems-engineer-cqkqP_HXDgDPfxnVVQNgaB?ref=rss&sid=68',
      location: 'Huntsville, AL ', city: 'Huntsville', state: 'AL', country: 'US', remote: 'No | Must be able to work onsite all of the time',
      opened_date: '2026-10-16T22:08:30.172Z',
      description: '<p>IERUS builds &amp; ships.</p><ul><li>RF</li><li>ML</li></ul>',
    },
    { id: 'rem1', title: 'Remote Dev', detail_url: 'https://careers.jobscore.com/careers/ierus/jobs/rem1', city: '', state: '', country: 'US', remote: 'Yes | Can work remotely all of the time', opened_date: 'garbage', description: '' },
    { id: 'hyb1', title: 'Hybrid Dev', detail_url: 'https://evil.example/steal', city: 'Austin', state: 'TX', remote: 'Yes | Can work remotely some of the time' },
    { id: '', title: 'No id' },
    { id: 'x9', title: '   ' },
    null,
  ],
};

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/jobscore.mjs')).href);
  const js = mod.default;
  const { parseJobScoreFeed } = mod;

  if (js.id === 'jobscore') pass('jobscore.id is "jobscore"'); else fail(`jobscore.id is ${js.id}`);

  const hit = js.detect({ name: 'I', careers_url: 'https://careers.jobscore.com/careers/ierustechnologiesinc/' });
  if (hit?.url === 'https://careers.jobscore.com/jobs/ierustechnologiesinc/feed.json') pass('jobscore.detect() claims careers.jobscore.com/careers/<slug>'); else fail(`jobscore.detect() returned ${JSON.stringify(hit)}`);
  for (const [label, u] of [
    ['wrong host', 'https://example.com/careers/ierus'],
    ['http scheme', 'http://careers.jobscore.com/careers/ierus'],
    ['lookalike host', 'https://evil-careers.jobscore.com.evil.example/careers/ierus'],
    ['sibling subdomain', 'https://evil.jobscore.com/careers/ierus'],
    ['path spoof', 'https://evil.example/careers.jobscore.com/careers/ierus'],
    ['no slug', 'https://careers.jobscore.com/'],
    ['slug with traversal chars', 'https://careers.jobscore.com/careers/..%2Fadmin'],
  ]) {
    if (js.detect({ name: 'X', careers_url: u }) === null) pass(`jobscore.detect() rejects ${label}`);
    else fail(`jobscore.detect() must reject ${label}: ${u}`);
  }
  if (js.detect({ name: 'X', careers_url: 7 }) === null && js.detect({ name: 'X' }) === null) pass('jobscore.detect() null for non-string/missing careers_url');
  else fail('jobscore.detect() non-string careers_url');

  const rows = parseJobScoreFeed(FEED, 'ierus', 'IERUS');
  const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]));
  const a = byTitle['COMSEC Systems Engineer'];
  if (a && a.url === 'https://careers.jobscore.com/careers/ierus/jobs/comsec-systems-engineer-cqkqP_HXDgDPfxnVVQNgaB' && a.location === 'Huntsville, AL' && a.company === 'IERUS' && a.postedAt === Date.parse('2026-10-16T22:08:30.172Z')) pass('parseJobScoreFeed maps title (trimmed), clean url (query stripped), location, company, postedAt');
  else fail(`parseJobScoreFeed job a = ${JSON.stringify(a)}`);
  if (a && a.description === 'IERUS builds & ships.\nRF\nML') pass('parseJobScoreFeed turns the HTML description into plain text'); else fail(`parseJobScoreFeed description = ${JSON.stringify(a?.description)}`);
  const r = byTitle['Remote Dev'];
  if (r && r.location === 'US, Remote' && !('postedAt' in r) && !('description' in r)) pass('parseJobScoreFeed: country fallback + Remote, omits unparseable date and empty description'); else fail(`parseJobScoreFeed remote job = ${JSON.stringify(r)}`);
  const h = byTitle['Hybrid Dev'];
  if (h && h.url === 'https://careers.jobscore.com/careers/ierus/jobs/hyb1' && h.location === 'Austin, TX') pass('parseJobScoreFeed: off-host detail_url replaced by pinned URL; "some of the time" is not Remote'); else fail(`parseJobScoreFeed hybrid job = ${JSON.stringify(h)}`);
  if (rows.length === 3) pass('parseJobScoreFeed drops rows with no id, blank title, or null'); else fail(`parseJobScoreFeed kept ${JSON.stringify(rows.map((x) => x.title))}`);
  if (parseJobScoreFeed({}, 's', 'X').length === 0 && parseJobScoreFeed(null, 's', 'X').length === 0 && parseJobScoreFeed({ jobs: 'x' }, 's', 'X').length === 0) pass('parseJobScoreFeed malformed payloads → []'); else fail('parseJobScoreFeed should return [] for malformed payloads');
  if (parseJobScoreFeed(FEED, 'ierus', '')[0].company === 'IERUS Technologies, Inc.') pass('parseJobScoreFeed falls back to feed company_name when entry name is empty'); else fail('parseJobScoreFeed company fallback');

  const calls = [];
  const ctx = { transport: 'http', fetchJson: async (url, opts) => { calls.push({ url, opts }); return FEED; } };
  const jobs = await js.fetch({ name: 'IERUS', careers_url: 'https://careers.jobscore.com/careers/ierus' }, ctx);
  if (calls.length === 1 && calls[0].url === 'https://careers.jobscore.com/jobs/ierus/feed.json?sort=date&limit=1000' && calls[0].opts?.redirect === 'error' && jobs.length === 3) pass('jobscore.fetch() makes one redirect:error request to feed.json and returns jobs');
  else fail(`jobscore.fetch() calls=${JSON.stringify(calls)} jobs=${jobs.length}`);

  calls.length = 0;
  let threw = false;
  try { await js.fetch({ name: 'Evil', careers_url: 'https://evil.example/careers/ierus' }, ctx); } catch { threw = true; }
  if (threw && calls.length === 0) pass('jobscore.fetch() rejects a hostile careers_url without any request');
  else fail(`jobscore.fetch() hostile url threw=${threw} calls=${calls.length}`);
} catch (e) {
  fail(`jobscore provider tests crashed: ${e.message}`);
}
