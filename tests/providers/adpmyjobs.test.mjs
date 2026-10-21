// tests/providers/adpmyjobs.test.mjs — ADP MyJobs provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — adpmyjobs');

const GOOD = 'https://myjobs.adp.com/stellantisexternalcx/cx/job-list';
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/adpmyjobs.mjs')).href);
  const p = mod.default;
  const { parseAdpMyJobsResponse, adpMyJobsLocation } = mod;

  check(p.id === 'adpmyjobs', 'adpmyjobs.id is "adpmyjobs"', JSON.stringify(p.id));

  const hit = p.detect({ name: 'Stellantis', careers_url: GOOD });
  check(hit?.url === 'https://myjobs.adp.com/public/staffing/v1/career-site/stellantisexternalcx', 'adpmyjobs.detect() resolves slug → career-site record URL', JSON.stringify(hit));
  const negatives = {
    'wrong host': 'https://example.com/stellantisexternalcx/cx/job-list',
    'http scheme': GOOD.replace('https:', 'http:'),
    'lookalike host (evil-)': GOOD.replace('myjobs.adp.com', 'evil-myjobs.adp.com'),
    'lookalike suffix': GOOD.replace('myjobs.adp.com', 'myjobs.adp.com.evil.test'),
    'host in path': 'https://evil.test/myjobs.adp.com/stellantisexternalcx/cx',
    'reserved /public route': 'https://myjobs.adp.com/public/staffing/v1/career-site/x',
    'workforcenow host': 'https://workforcenow.adp.com/stellantisexternalcx/cx',
    'no slug': 'https://myjobs.adp.com/',
    'hostile slug chars': 'https://myjobs.adp.com/a%2e%2e%2fb/cx',
  };
  for (const [label, url] of Object.entries(negatives)) {
    check(p.detect({ name: 'X', careers_url: url }) === null, `adpmyjobs.detect() rejects ${label}`);
  }
  check(p.detect({ name: 'X', careers_url: null }) === null && p.detect({ name: 'X', careers_url: 7 }) === null, 'adpmyjobs.detect() tolerates non-string careers_url');

  // parser — live payload shape (trimmed)
  const req = (over = {}) => ({
    reqId: '5001212788906',
    jobTitle: 'ADAS Subsystem Technical Lead',
    requisitionLocations: [{ address: { cityName: 'Colonia Santa Fe', countrySubdivisionLevel1: { longName: 'Ciudad de México' }, country: { longName: 'Mexico' } } }],
    ...over,
  });
  const payload = { count: 5, jobRequisitions: [req(), req({ reqId: '2', jobTitle: 'No Loc', requisitionLocations: [] }), req({ reqId: '', jobTitle: 'No Id' }), req({ reqId: '4', jobTitle: '  ' }), null] };
  const jobs = parseAdpMyJobsResponse(payload, 'Stellantis', 'stellantisexternalcx');
  check(jobs.length === 2 && jobs[0].title === 'ADAS Subsystem Technical Lead' && jobs[1].title === 'No Loc', 'parseAdpMyJobsResponse keeps valid rows, drops missing id / blank title / null', jobs.map(j => j.title).join('|'));
  check(jobs[0].url === 'https://myjobs.adp.com/stellantisexternalcx/cx/job/5001212788906', 'parseAdpMyJobsResponse builds cx/job URL', jobs[0].url);
  check(jobs[0].location === 'Colonia Santa Fe, Ciudad de México, Mexico' && jobs[1].location === '', 'parseAdpMyJobsResponse joins City, Region, Country; empty when no location');
  check(adpMyJobsLocation(req({ requisitionLocations: [{ address: { cityName: ' Paris ', country: { longName: 'France' } } }] })) === 'Paris, France', 'adpMyJobsLocation drops empty parts');
  check(!('description' in jobs[0]) && !('postedAt' in jobs[0]) && !('salary' in jobs[0]), 'parseAdpMyJobsResponse omits fields the list does not carry');
  check(parseAdpMyJobsResponse({}, 'X', 's').length === 0 && parseAdpMyJobsResponse({ jobRequisitions: 'x' }, 'X', 's').length === 0, 'parseAdpMyJobsResponse malformed payload → []');

  // fetch() — mock ctx
  const calls = [];
  const sleeps = [];
  const rows = (n, base) => Array.from({ length: n }, (_, i) => req({ reqId: `${base}${i}`, jobTitle: `Role ${base}${i}` }));
  const mkCtx = (listPages, site = { orgoid: 'G2QKPTS5DSF914GQ', clientName: 'Stellantis' }) => ({
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      if (new URL(url).hostname === 'myjobs.adp.com') return site;
      const skip = Number(new URL(url).searchParams.get('$skip'));
      return listPages[skip] ?? { count: 0, jobRequisitions: [] };
    },
    sleep: async ms => { sleeps.push(ms); },
  });
  const pages = { 0: { count: 70, jobRequisitions: rows(50, 'a') }, 50: { count: 70, jobRequisitions: rows(20, 'b') } };
  const all = await p.fetch({ name: 'Stellantis', careers_url: GOOD }, mkCtx(pages));
  check(all.length === 70, 'adpmyjobs.fetch() pages until count reached', `jobs=${all.length}`);
  check(calls.length === 3 && calls[0].url === 'https://myjobs.adp.com/public/staffing/v1/career-site/stellantisexternalcx', 'adpmyjobs.fetch() first resolves the career-site record, then lists (3 calls)', calls.map(c => c.url).join(' '));
  check(calls.every(c => c.opts?.redirect === 'error'), 'adpmyjobs.fetch() passes redirect:error on every request');
  check(calls.slice(1).every(c => c.opts.headers?.orgoid === 'G2QKPTS5DSF914GQ' && new URL(c.url).hostname === 'my.adp.com'), 'adpmyjobs.fetch() sends orgoid header to the pinned list host');
  check(!('orgoid' in (calls[0].opts.headers ?? {})), 'adpmyjobs.fetch() does not send orgoid on the site-record request (control)');
  check(sleeps.length === 1, 'adpmyjobs.fetch() paces between pages', `sleeps=${sleeps.length}`);

  calls.length = 0;
  const capped = await p.fetch({ name: 'Stellantis', careers_url: GOOD }, { ...mkCtx(pages), maxPages: 1 });
  check(capped.length === 50 && calls.length === 2, 'adpmyjobs.fetch() honours ctx.maxPages', `jobs=${capped.length} calls=${calls.length}`);

  // company fallback to the site record when entry has no name
  const unnamed = await p.fetch({ name: '', careers_url: GOOD }, { ...mkCtx(pages), maxPages: 1 });
  check(unnamed[0]?.company === 'Stellantis', 'adpmyjobs.fetch() falls back to site clientName for company', unnamed[0]?.company);

  // missing/hostile orgoid → error, no list request
  calls.length = 0;
  let threw = '';
  try { await p.fetch({ name: 'X', careers_url: GOOD }, mkCtx(pages, { orgoid: '' })); } catch (e) { threw = e.message; }
  check(/orgoid/.test(threw) && calls.length === 1, 'adpmyjobs.fetch() errors on missing orgoid without listing', `threw="${threw}" calls=${calls.length}`);
  threw = '';
  calls.length = 0;
  try { await p.fetch({ name: 'X', careers_url: GOOD }, mkCtx(pages, { orgoid: 'bad\r\nx-evil: 1' })); } catch (e) { threw = e.message; }
  check(/orgoid/.test(threw) && calls.length === 1, 'adpmyjobs.fetch() rejects header-injection orgoid');

  // SSRF
  let hits = 0;
  threw = '';
  try { await p.fetch({ name: 'Evil', careers_url: 'https://evil.test/stellantisexternalcx/cx' }, { fetchJson: async () => { hits++; return {}; } }); } catch (e) { threw = e.message; }
  check(/cannot derive/.test(threw) && hits === 0, 'adpmyjobs.fetch() rejects hostile careers_url before any request', `threw="${threw}" hits=${hits}`);
} catch (e) {
  fail(`adpmyjobs provider tests crashed: ${e.message}`);
}
