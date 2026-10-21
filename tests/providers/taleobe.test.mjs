// tests/providers/taleobe.test.mjs — Oracle Taleo Business Edition RSS provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — taleobe');

// Trimmed from a live feed (AMERINC:52, probed 2026-10-21), same element shapes.
const FEED = `<?xml version="1.0" encoding="UTF-8" ?>
<rss xmlns:taleo="urn:TBERss" version="2.0">
<channel>
<title>AmeriHealth Caritas Health Plan Job Feed</title>
<link>https://phh.tbe.taleo.net/dispatcher/servlet/DispatcherServlet?org=AMERINC&amp;act=redirectCws&amp;cws=52</link>
<item>
<title>Network Contractor - Provider Network Management (PNM)</title>
<link>https://phh.tbe.taleo.net/phh02/ats/careers/requisition.jsp?org=AMERINC&amp;cws=52&amp;rid=45049</link>
<description>  Role Overview:  Contracting &#8239; providers &amp; payers.   Work Arrangements:    Remote - Louisiana.  </description>
<pubDate>Tue, 20 Oct 2026 13:12:18 GMT</pubDate>
<taleo:reqId>45049</taleo:reqId>
<taleo:location>Baton Rouge, LA</taleo:location>
<taleo:locationCountry>US</taleo:locationCountry>
<taleo:locationState>Louisiana</taleo:locationState>
<taleo:locationCity>Baton Rouge</taleo:locationCity>
<taleo:html-description>&lt;p&gt;should NOT be used&lt;/p&gt;</taleo:html-description>
</item>
<item>
<title>Remote Analyst</title>
<link>http://evil.example/x?rid=45117</link>
<description>Plain body</description>
<taleo:reqId>45117</taleo:reqId>
<taleo:locationState>Texas</taleo:locationState>
<taleo:locationCity>Austin</taleo:locationCity>
</item>
<item>
<title>Id From Link Only</title>
<link>https://phh.tbe.taleo.net/phh02/ats/careers/requisition.jsp?org=AMERINC&amp;cws=52&amp;rid=777</link>
<taleo:location>Remote, United States</taleo:location>
</item>
<item>
<title></title>
<taleo:reqId>1</taleo:reqId>
</item>
<item>
<title>No Id At All</title>
<link>https://phh.tbe.taleo.net/phh02/ats/careers/requisition.jsp?org=AMERINC&amp;cws=52</link>
</item>
<item>
<title>Duplicate of 45049</title>
<taleo:reqId>45049</taleo:reqId>
</item>
</channel>
</rss>`;

const GOOD = 'https://phh.tbe.taleo.net/phh02/ats/careers/v2/searchResults?org=AMERINC&cws=52';

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/taleobe.mjs')).href);
  const taleobe = mod.default;
  const { parseTaleobeFeed, parseTaleobeUrl } = mod;

  if (taleobe.id === 'taleobe') pass('taleobe.id is "taleobe"');
  else fail(`taleobe.id is ${JSON.stringify(taleobe.id)}`);

  // detect: positive (requisition link, v2 link, lower-case org, extra tracking params)
  const expectUrl = 'https://phh.tbe.taleo.net/phh02/ats/servlet/Rss?org=AMERINC&cws=52';
  for (const u of [
    GOOD,
    'https://phh.tbe.taleo.net/phh02/ats/careers/requisition.jsp?org=AMERINC&cws=52&rid=3413',
    'https://phh.tbe.taleo.net/phh02/ats/careers/requisition.jsp?org=amerinc&cws=52&source=Indeed',
  ]) {
    const hit = taleobe.detect({ name: 'A', careers_url: u });
    if (hit?.url === expectUrl) pass(`taleobe.detect() resolves ${u.slice(8, 60)}…`);
    else fail(`taleobe.detect(${u}) returned ${JSON.stringify(hit)}`);
  }

  // detect: negatives — each must return null for ITS OWN reason (controls above prove GOOD matches)
  /** @type {Array<[string, any]>} */
  const negatives = [
    ['Taleo Enterprise careersection URL', 'https://valero.taleo.net/careersection/2/jobsearch.ftl?lang=en'],
    ['Enterprise URL carrying org/cws query', 'https://valero.taleo.net/careersection/2/jobsearch.ftl?org=AMERINC&cws=52'],
    ['http scheme', 'http://phh.tbe.taleo.net/phh02/ats/careers/v2/searchResults?org=AMERINC&cws=52'],
    ['lookalike host (suffix)', 'https://phh.tbe.taleo.net.evil.example/phh02/ats/careers/v2/searchResults?org=AMERINC&cws=52'],
    ['lookalike host (prefix)', 'https://evil-tbe.taleo.net/phh02/ats/careers/v2/searchResults?org=AMERINC&cws=52'],
    ['host in path', 'https://evil.example/phh.tbe.taleo.net/phh02/ats/x?org=AMERINC&cws=52'],
    ['bare tbe.taleo.net (no pod host)', 'https://tbe.taleo.net/phh02/ats/careers/v2/searchResults?org=AMERINC&cws=52'],
    ['dispatcher link without pod path', 'https://phh.tbe.taleo.net/dispatcher/servlet/DispatcherServlet?org=AMERINC&act=redirectCws&cws=52'],
    ['missing org', 'https://phh.tbe.taleo.net/phh02/ats/careers/requisition.jsp?cws=52&rid=3413'],
    ['non-numeric cws', 'https://phh.tbe.taleo.net/phh02/ats/careers/requisition.jsp?org=AMERINC&cws=x'],
    ['hostile org', 'https://phh.tbe.taleo.net/phh02/ats/careers/requisition.jsp?org=A/../B&cws=52'],
    ['non-string', 7],
    ['null', null],
  ];
  for (const [label, u] of negatives) {
    const hit = taleobe.detect({ name: 'X', careers_url: u });
    if (hit === null) pass(`taleobe.detect() rejects: ${label}`);
    else fail(`taleobe.detect() should reject ${label}, got ${JSON.stringify(hit)}`);
  }

  // Mutual exclusion with taleo.mjs: neither claims the other's URL.
  const taleo = (await import(pathToFileURL(join(ROOT, 'providers/taleo.mjs')).href)).default;
  const enterprise = 'https://valero.taleo.net/careersection/2/jobsearch.ftl?lang=en';
  if (taleo.detect({ name: 'E', careers_url: enterprise }) && !taleobe.detect({ name: 'E', careers_url: enterprise })) {
    pass('enterprise URL is claimed by taleo only');
  } else {
    fail('enterprise URL should be claimed by taleo and not taleobe');
  }
  if (!taleo.detect({ name: 'B', careers_url: GOOD }) && taleobe.detect({ name: 'B', careers_url: GOOD })) {
    pass('TBE URL is claimed by taleobe only');
  } else {
    fail('TBE URL should be claimed by taleobe and not taleo');
  }

  const board = parseTaleobeUrl(GOOD);
  if (board && board.pod === 'phh02' && board.org === 'AMERINC' && board.cws === '52' && board.host === 'phh.tbe.taleo.net') {
    pass('parseTaleobeUrl extracts host/pod/org/cws');
  } else {
    fail(`parseTaleobeUrl returned ${JSON.stringify(board)}`);
  }

  // parseTaleobeFeed — identity, not count
  const jobs = parseTaleobeFeed(FEED, /** @type {any} */ (board), 'AmeriHealth');
  const byTitle = Object.fromEntries(jobs.map(j => [j.title, j]));
  const want = ['Network Contractor - Provider Network Management (PNM)', 'Remote Analyst', 'Id From Link Only'];
  const missing = want.filter(t => !byTitle[t]);
  const extra = jobs.map(j => j.title).filter(t => !want.includes(t));
  if (missing.length === 0 && extra.length === 0) pass('parseTaleobeFeed keeps exactly the 3 well-formed items');
  else fail(`parseTaleobeFeed missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(extra)}`);

  const a = byTitle['Network Contractor - Provider Network Management (PNM)'];
  if (a?.url === 'https://phh.tbe.taleo.net/phh02/ats/careers/requisition.jsp?org=AMERINC&cws=52&rid=45049' && a.company === 'AmeriHealth') {
    pass('parseTaleobeFeed builds posting URL from board + reqId, sets company');
  } else {
    fail(`first job was ${JSON.stringify(a)}`);
  }
  if (a?.location === 'Baton Rouge, LA') pass('parseTaleobeFeed uses taleo:location');
  else fail(`location was ${JSON.stringify(a?.location)}`);
  if (a?.postedAt === Date.UTC(2026, 9, 20, 13, 12, 18)) pass('parseTaleobeFeed parses pubDate to epoch ms');
  else fail(`postedAt was ${a?.postedAt}`);
  if (a?.description === 'Role Overview: Contracting providers & payers. Work Arrangements: Remote - Louisiana.') {
    pass('parseTaleobeFeed description is the decoded, whitespace-collapsed plain <description> (not html-description)');
  } else {
    fail(`description was ${JSON.stringify(a?.description)}`);
  }

  const b = byTitle['Remote Analyst'];
  if (b?.url.startsWith('https://phh.tbe.taleo.net/phh02/') && !b.url.includes('evil.example')) {
    pass('parseTaleobeFeed never trusts the feed link host');
  } else {
    fail(`off-host feed link leaked: ${b?.url}`);
  }
  if (b?.location === 'Austin, Texas' && !('postedAt' in b)) pass('parseTaleobeFeed falls back to city+state and omits postedAt when absent');
  else fail(`fallback item was ${JSON.stringify(b)}`);

  const c = byTitle['Id From Link Only'];
  if (c?.url.endsWith('&rid=777') && c.location === 'Remote, United States' && !('description' in c)) {
    pass('parseTaleobeFeed takes rid from the link when reqId is absent; omits empty description');
  } else {
    fail(`link-rid item was ${JSON.stringify(c)}`);
  }

  if (parseTaleobeFeed('', /** @type {any} */ (board)).length === 0 && parseTaleobeFeed(/** @type {any} */ (null), /** @type {any} */ (board)).length === 0
    && parseTaleobeFeed('<rss><channel></channel></rss>', /** @type {any} */ (board)).length === 0) {
    pass('parseTaleobeFeed empty/null/empty-channel → []');
  } else {
    fail('parseTaleobeFeed should return [] for empty input');
  }

  // fetch() with mock ctx
  /** @type {Array<{url: string, opts: any}>} */
  const calls = [];
  const ctx = { fetchText: async (/** @type {string} */ url, /** @type {any} */ opts) => { calls.push({ url, opts }); return FEED; } };
  const fetched = await taleobe.fetch({ name: 'AmeriHealth', careers_url: GOOD }, /** @type {any} */ (ctx));
  if (calls.length === 1 && calls[0].url === expectUrl) pass('taleobe.fetch() makes exactly one request, to the pod feed URL');
  else fail(`taleobe.fetch() calls=${JSON.stringify(calls.map(x => x.url))}`);
  if (calls[0]?.opts?.redirect === 'error') pass('taleobe.fetch() passes redirect:"error"');
  else fail(`taleobe.fetch() opts=${JSON.stringify(calls[0]?.opts)}`);
  if (fetched.length === 3 && fetched[0].company === 'AmeriHealth') pass('taleobe.fetch() returns parsed jobs');
  else fail(`taleobe.fetch() returned ${fetched.length} jobs`);

  // entry.name fallback to org when name blank
  const noName = await taleobe.fetch({ name: '  ', careers_url: GOOD }, /** @type {any} */ (ctx));
  if (noName[0]?.company === 'AMERINC') pass('taleobe.fetch() falls back to org code when entry.name is blank');
  else fail(`blank-name company was ${JSON.stringify(noName[0]?.company)}`);

  // hostile careers_url: rejected before ANY request
  const before = calls.length;
  let threw = '';
  for (const u of [
    'https://phh.tbe.taleo.net.evil.example/phh02/ats/x?org=AMERINC&cws=52',
    'http://phh.tbe.taleo.net/phh02/ats/x?org=AMERINC&cws=52',
    'https://valero.taleo.net/careersection/2/jobsearch.ftl',
    'https://evil.example/',
  ]) {
    try {
      await taleobe.fetch({ name: 'Evil', careers_url: u }, /** @type {any} */ (ctx));
      threw += `[no throw: ${u}]`;
    } catch { /* expected */ }
  }
  if (threw === '' && calls.length === before) pass('taleobe.fetch() rejects hostile careers_url before any request');
  else fail(`hostile careers_url: ${threw} requests=${calls.length - before}`);
} catch (e) {
  fail(`taleobe provider tests crashed: ${e.message}`);
}
