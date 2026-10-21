// tests/providers/talentlyft.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — talentlyft');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/talentlyft.mjs')).href);
  const talentlyft = mod.default;

  check(talentlyft.id === 'talentlyft', 'talentlyft.id is "talentlyft"');

  check(talentlyft.detect({ name: 'I', careers_url: 'https://inetec.talentlyft.com/' })?.url === 'https://inetec.talentlyft.com/sitemap.xml', 'detect() claims <tenant>.talentlyft.com');
  for (const [label, url] of [
    ['wrong host', 'https://example.com/careers'],
    ['http scheme', 'http://inetec.talentlyft.com/'],
    ['lookalike host', 'https://evil-talentlyft.com/'],
    ['lookalike suffix', 'https://inetec.talentlyft.com.evil.com/'],
    ['host in path', 'https://evil.example/inetec.talentlyft.com'],
    ['reserved www', 'https://www.talentlyft.com/'],
    ['non-string', null],
  ]) {
    check(talentlyft.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }

  // sitemap — shape seen live; root, foreign host, http and non-job paths are dropped
  const H = 'inetec.talentlyft.com';
  const xml = `<urlset>
    <url><loc>https://${H}/jobs/open-applications-EyH</loc></url>
    <url><loc>https://${H}/jobs/field-service-associate-cjcw</loc></url>
    <url><loc>https://${H}/jobs/field-service-associate-cjcw/</loc></url>
    <url><loc>https://${H}/jobs/senior-software-engineer-ckgN?utm=x</loc></url>
    <url><loc>https://${H}</loc></url>
    <url><loc>https://${H}/about</loc></url>
    <url><loc>https://evil.example/jobs/trap-abcd</loc></url>
    <url><loc>http://${H}/jobs/insecure-abcd</loc></url>
  </urlset>`;
  const urls = mod.parseSitemapJobUrls(xml, H);
  check(urls.join() === `https://${H}/jobs/open-applications-EyH,https://${H}/jobs/field-service-associate-cjcw,https://${H}/jobs/senior-software-engineer-ckgN`, 'sitemap: keeps https same-host /jobs/<slug>-<code>, dedups, drops root/foreign/http');

  const page = (extra = {}) => {
    const ld = {
      context: 'https://schema.org/',
      '@type': 'JobPosting',
      title: 'Field Service Associate',
      description: '&lt;p&gt;Conduct &lt;strong&gt;NDT&lt;/strong&gt; &amp;amp; more&lt;/p&gt;',
      datePosted: '2026-08-23',
      jobLocation: { address: { addressLocality: 'Zagreb', addressCountry: 'HR' } },
      ...extra,
    };
    return `<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>`;
  };
  const job = mod.parsePostingPage(page(), `https://${H}/jobs/x-abcd`, 'Inetec');
  check(job?.title === 'Field Service Associate' && job.location === 'Zagreb, HR' && job.postedAt === Date.parse('2026-08-23'), 'posting: title, location, postedAt from ld+json');
  check(job?.description === 'Conduct NDT & more', `posting: escaped-HTML description decoded to text (got ${JSON.stringify(job?.description)})`);
  check(mod.parsePostingPage(page({ '@type': 'Organization' }), 'https://x', 'X') === null, 'posting: non-JobPosting ld+json → null');
  check(mod.parsePostingPage(page({ title: '' }), 'https://x', 'X') === null, 'posting: empty title → null');
  check(mod.parsePostingPage('<html>no ld here</html>', 'https://x', 'X') === null, 'posting: no ld+json → null');

  // fetch
  const seen = [];
  const optsSeen = [];
  const ctx = {
    fetchText: async (url, o) => {
      seen.push(url);
      optsSeen.push(o);
      if (url.endsWith('/sitemap.xml')) return xml;
      if (url.endsWith('cjcw')) throw new Error('HTTP 500'); // one broken posting
      return page({ title: `T ${url.slice(-4)}` });
    },
    sleep: async () => {},
  };
  const got = await talentlyft.fetch({ name: 'Inetec', careers_url: 'https://inetec.talentlyft.com/' }, ctx);
  check(seen[0] === `https://${H}/sitemap.xml` && seen.length === 4, 'fetch() requests sitemap then each of the 3 postings');
  check(got.map(j => j.title).join() === 'T -EyH,T ckgN', `fetch() drops the failing posting, keeps the other two (got ${got.map(j => j.title).join()})`);
  check(optsSeen.every(o => o?.redirect === 'error'), 'every request uses redirect:error');

  // maxPages caps detail fetches (PER_PAGE=20 per page): 25 sitemap entries, maxPages=1 → 20
  let bigSleeps = 0;
  const big = `<urlset>${Array.from({ length: 25 }, (_, i) => `<url><loc>https://${H}/jobs/role-${i}-a${String(i).padStart(3, '0')}</loc></url>`).join('')}</urlset>`;
  seen.length = 0;
  const bigCtx = { fetchText: async url => { seen.push(url); return url.endsWith('/sitemap.xml') ? big : page(); }, sleep: async () => { bigSleeps++; } };
  const capped = await talentlyft.fetch({ name: 'I', careers_url: 'https://inetec.talentlyft.com/' }, { ...bigCtx, maxPages: 1 });
  const uncapped = await talentlyft.fetch({ name: 'I', careers_url: 'https://inetec.talentlyft.com/' }, bigCtx);
  check(capped.length === 20 && uncapped.length === 25, `maxPages=1 caps at 20 postings, default cap covers all 25 (got ${capped.length}/${uncapped.length})`);
  check(bigSleeps > 0, 'pacing hook is used between batches');

  // sitemap failure must fail the board, not look empty
  let threw = false;
  try {
    await talentlyft.fetch({ name: 'I', careers_url: 'https://inetec.talentlyft.com/' }, { fetchText: async () => { throw new Error('HTTP 503'); } });
  } catch {
    threw = true;
  }
  check(threw, 'sitemap fetch failure propagates');

  // SSRF
  threw = false;
  const before = seen.length;
  try {
    await talentlyft.fetch({ name: 'Evil', careers_url: 'https://evil.example/' }, bigCtx);
  } catch {
    threw = true;
  }
  check(threw && seen.length === before, 'fetch() rejects hostile careers_url without any request');
} catch (e) {
  fail(`talentlyft provider tests crashed: ${e.message}`);
}
