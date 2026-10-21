// tests/providers/trakstar.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — trakstar');

const item = (title, link, desc, extra = '') =>
  `<item><title>${title}</title><link>${link}</link><description>${desc}</description>` +
  `<pubDate>Fri, 25 Sep 2026 00:00:00 +0530</pubDate><guid>${link}</guid>${extra}</item>`;
const FEED = `<?xml version="1.0"?><rss version="2.0"><channel xmlns:job="https://recruiterbox.com/rss/job/"><title>Jobs</title>` +
  item('[Contractor] Senior Engineer &amp; Lead', 'http://acme.hire.trakstar.com/jobs/fk0zr7h',
    '&lt;h2&gt;Meta&lt;/h2&gt;&lt;p&gt;Build &amp;amp; ship things.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Rust&lt;/li&gt;&lt;/ul&gt;',
    '<job:locationCity>USA</job:locationCity><job:locationState></job:locationState><job:locationCountry></job:locationCountry>') +
  item('Designer', 'https://acme.hire.trakstar.com/jobs/abc123', '', '<job:locationCity>Berlin</job:locationCity><job:locationState>BE</job:locationState><job:locationCountry>DE</job:locationCountry>') +
  item('Offsite link', 'http://evil.example/jobs/zzz', 'x') +
  item('', 'http://acme.hire.trakstar.com/jobs/notitle', 'x') +
  `</channel></rss>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/trakstar.mjs')).href);
  const tk = mod.default;
  const { parseTrakstarFeed } = mod;

  if (tk.id === 'trakstar') pass('trakstar.id is "trakstar"'); else fail(`trakstar.id is ${tk.id}`);

  const hit = tk.detect({ name: 'C', careers_url: 'https://cheesecakelabs.hire.trakstar.com/jobs' });
  if (hit?.url === 'https://cheesecakelabs.hire.trakstar.com/jobfeeds/cheesecakelabs') pass('trakstar.detect() claims <board>.hire.trakstar.com → feed URL'); else fail(`trakstar.detect() returned ${JSON.stringify(hit)}`);
  for (const [label, u] of [
    ['wrong host', 'https://example.com/jobs'],
    ['http scheme', 'http://acme.hire.trakstar.com/jobs'],
    ['lookalike host', 'https://evil-hire.trakstar.com.evil.example/jobs'],
    ['lookalike apex', 'https://acme.hire-trakstar.com/jobs'],
    ['path spoof', 'https://evil.example/acme.hire.trakstar.com/jobs'],
    ['bare apex', 'https://hire.trakstar.com/jobs'],
  ]) {
    if (tk.detect({ name: 'X', careers_url: u }) === null) pass(`trakstar.detect() rejects ${label}`);
    else fail(`trakstar.detect() must reject ${label}: ${u}`);
  }
  if (tk.detect({ name: 'X', careers_url: 7 }) === null && tk.detect({ name: 'X' }) === null) pass('trakstar.detect() null for non-string/missing careers_url');
  else fail('trakstar.detect() non-string careers_url');

  const rows = parseTrakstarFeed(FEED, 'Acme');
  const a = rows.find((r) => r.url === 'https://acme.hire.trakstar.com/jobs/fk0zr7h');
  const b = rows.find((r) => r.url === 'https://acme.hire.trakstar.com/jobs/abc123');
  if (a && a.title === '[Contractor] Senior Engineer & Lead' && a.location === 'USA' && a.company === 'Acme' && a.postedAt === Date.parse('Fri, 25 Sep 2026 00:00:00 +0530')) pass('parseTrakstarFeed maps title, https url, location, company, postedAt');
  else fail(`parseTrakstarFeed job a = ${JSON.stringify(a)}`);
  if (a && a.description === 'Meta\nBuild & ship things.\nRust') pass('parseTrakstarFeed turns the escaped HTML body into plain-text description');
  else fail(`parseTrakstarFeed description = ${JSON.stringify(a?.description)}`);
  if (b && b.location === 'Berlin, BE, DE' && !('description' in b)) pass('parseTrakstarFeed joins city/state/country and omits an empty description');
  else fail(`parseTrakstarFeed job b = ${JSON.stringify(b)}`);
  if (rows.length === 2 && !rows.some((r) => r.title === 'Offsite link')) pass('parseTrakstarFeed drops off-host links and untitled items'); else fail(`parseTrakstarFeed rows = ${JSON.stringify(rows.map((r) => r.title))}`);
  if (parseTrakstarFeed(null, 'A').length === 0 && parseTrakstarFeed('<rss></rss>', 'A').length === 0) pass('parseTrakstarFeed non-string/empty → []'); else fail('parseTrakstarFeed should return [] for null/empty');

  const calls = [];
  const ctx = { transport: 'http', fetchText: async (url, opts) => { calls.push({ url, opts }); return FEED; } };
  const jobs = await tk.fetch({ name: 'Acme', careers_url: 'https://acme.hire.trakstar.com/jobs' }, ctx);
  if (calls.length === 1 && calls[0].url === 'https://acme.hire.trakstar.com/jobfeeds/acme' && calls[0].opts?.redirect === 'error' && jobs.length === 2) pass('trakstar.fetch() makes one redirect:error request to the feed and returns jobs');
  else fail(`trakstar.fetch() calls=${JSON.stringify(calls)} jobs=${jobs.length}`);

  calls.length = 0;
  let threw = false;
  try { await tk.fetch({ name: 'Evil', careers_url: 'https://evil.example/jobs' }, ctx); } catch { threw = true; }
  if (threw && calls.length === 0) pass('trakstar.fetch() rejects a hostile careers_url without any request');
  else fail(`trakstar.fetch() hostile url threw=${threw} calls=${calls.length}`);
} catch (e) {
  fail(`trakstar provider tests crashed: ${e.message}`);
}
