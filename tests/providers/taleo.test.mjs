// tests/providers/taleo.test.mjs — Oracle Taleo Enterprise provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — taleo');

const GOOD = 'https://valero.taleo.net/careersection/2/jobsearch.ftl?lang=en';
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/taleo.mjs')).href);
  const p = mod.default;
  const { parseTaleoResponse, parseTaleoDate, taleoSearchBody } = mod;

  check(p.id === 'taleo', 'taleo.id is "taleo"', JSON.stringify(p.id));

  const hit = p.detect({ name: 'Valero', careers_url: GOOD });
  check(hit?.url === GOOD, 'taleo.detect() resolves <tenant>.taleo.net/careersection/<n>/…', JSON.stringify(hit));
  check(p.detect({ name: 'V', careers_url: 'https://valero.taleo.net/careersection/2/jobdetail.ftl?job=2600180' })?.url === GOOD,
    'taleo.detect() accepts a jobdetail URL of the same section');
  const negatives = {
    'wrong host': 'https://example.com/careersection/2/jobsearch.ftl',
    'http scheme': GOOD.replace('https:', 'http:'),
    'lookalike host (evil-)': GOOD.replace('valero.taleo.net', 'evil-taleo.net'),
    'lookalike suffix': GOOD.replace('valero.taleo.net', 'valero.taleo.net.evil.test'),
    'host in path': 'https://evil.test/valero.taleo.net/careersection/2/jobsearch.ftl',
    'Business Edition host': 'https://tbe.taleo.net/careersection/2/jobsearch.ftl',
    'nested subdomain': 'https://a.b.taleo.net/careersection/2/jobsearch.ftl',
    'REST route as section': 'https://valero.taleo.net/careersection/rest/jobboard/searchjobs',
    'no careersection path': 'https://valero.taleo.net/other/2/jobsearch.ftl',
  };
  for (const [label, url] of Object.entries(negatives)) {
    check(p.detect({ name: 'X', careers_url: url }) === null, `taleo.detect() rejects ${label}`);
  }
  check(p.detect({ name: 'X', careers_url: null }) === null && p.detect({ name: 'X', careers_url: 7 }) === null, 'taleo.detect() tolerates non-string careers_url');

  // date parsing
  check(parseTaleoDate('Oct 20, 2026') === Date.UTC(2026, 9, 20), 'parseTaleoDate parses "Mon D, YYYY" as UTC midnight');
  check(parseTaleoDate('US-TX-San Antonio') === null && parseTaleoDate('2600180') === null && parseTaleoDate('Foo 20, 2026') === null, 'parseTaleoDate rejects non-date cells');

  // parser — live searchjobs shape (trimmed)
  const board = { host: 'valero.taleo.net', section: '2' };
  const payload = {
    requisitionList: [
      { jobId: '311290', contestNo: '2600180', column: ['Staff Data Scientist', '["US-TX-San Antonio"]', 'Oct 20, 2026'], locationsColumns: [1] },
      { jobId: '1', contestNo: '26001EZ', column: ['Nurse ', '["US-LA-Meraux","US-TX-Houston"]', 'Oct 20, 2026'], locationsColumns: [1] },
      { jobId: '2', contestNo: '26001ES', column: ['Plain Loc', 'Washington DC'], locationsColumns: [1] },
      { jobId: '3', contestNo: '', column: ['No Contest', 'x'], locationsColumns: [1] },
      { jobId: '4', contestNo: '26001XX', column: ['', 'x'], locationsColumns: [1] },
      { jobId: '5', contestNo: '26001YY', column: ['Bad Index', 'Anywhere'], locationsColumns: [9, -1] },
      null,
    ],
    pagingData: { totalCount: 7 },
  };
  const jobs = parseTaleoResponse(payload, 'Valero', board);
  check(jobs.map(j => j.title).join('|') === 'Staff Data Scientist|Nurse|Plain Loc|Bad Index', 'parseTaleoResponse keeps valid rows, drops no-contestNo / blank title / null (by identity)', jobs.map(j => j.title).join('|'));
  check(jobs[0].url === 'https://valero.taleo.net/careersection/2/jobdetail.ftl?job=2600180&lang=en' && jobs[0].company === 'Valero', 'parseTaleoResponse builds jobdetail URL from contestNo');
  check(jobs[0].location === 'US-TX-San Antonio' && jobs[1].location === 'US-LA-Meraux, US-TX-Houston' && jobs[2].location === 'Washington DC', 'parseTaleoResponse flattens JSON-array / plain location cells');
  check(jobs[3].location === '', 'parseTaleoResponse ignores out-of-range locationsColumns indexes');
  check(jobs[0].postedAt === Date.UTC(2026, 9, 20) && !('postedAt' in jobs[2]), 'parseTaleoResponse sets postedAt from the date cell, omits when tenant lists none');
  check(!('description' in jobs[0]) && !('salary' in jobs[0]), 'parseTaleoResponse omits description/salary');
  check(parseTaleoResponse({}, 'X', board).length === 0 && parseTaleoResponse({ requisitionList: 'x' }, 'X', board).length === 0, 'parseTaleoResponse malformed payload → []');
  check(taleoSearchBody(3).pageNo === 3, 'taleoSearchBody carries the 1-based page number');

  // fetch() — mock ctx
  const calls = [];
  const sleeps = [];
  const mkRows = (n, base) => Array.from({ length: n }, (_, i) => ({ jobId: `${i}`, contestNo: `${base}${i}`, column: [`Role ${base}${i}`, 'Austin'], locationsColumns: [1] }));
  const pages = { 1: { requisitionList: mkRows(25, 'a'), pagingData: { totalCount: 60 } }, 2: { requisitionList: mkRows(25, 'b'), pagingData: { totalCount: 60 } }, 3: { requisitionList: mkRows(10, 'c'), pagingData: { totalCount: 60 } } };
  const mkCtx = (section = 'portalNo: \'101430233\',') => ({
    fetchText: async (url, opts) => { calls.push({ kind: 'text', url, opts }); return `<script>var x = { ${section} y: 1 }</script>`; },
    fetchJson: async (url, opts) => { calls.push({ kind: 'json', url, opts }); return pages[JSON.parse(opts.body).pageNo] ?? { requisitionList: [] }; },
    sleep: async ms => { sleeps.push(ms); },
  });
  const all = await p.fetch({ name: 'Valero', careers_url: GOOD }, mkCtx());
  check(all.length === 60, 'taleo.fetch() pages until totalCount reached', `jobs=${all.length}`);
  check(calls.length === 4 && calls[0].kind === 'text' && calls[0].url === GOOD, 'taleo.fetch() GETs the careersection first, then POSTs 3 pages', calls.map(c => c.kind).join(','));
  const posts = calls.slice(1);
  check(posts.every(c => c.opts.method === 'POST' && c.opts.redirect === 'error' && c.url === 'https://valero.taleo.net/careersection/rest/jobboard/searchjobs?lang=en&portal=101430233'),
    'taleo.fetch() POSTs searchjobs with scraped portal and redirect:error');
  check(posts.map(c => JSON.parse(c.opts.body).pageNo).join(',') === '1,2,3' && posts[0].opts.headers.tz === 'GMT+00:00', 'taleo.fetch() advances pageNo and sends tz headers');
  check(calls[0].opts.redirect === 'error', 'taleo.fetch() passes redirect:error on the section GET');
  check(sleeps.length === 2, 'taleo.fetch() paces between pages', `sleeps=${sleeps.length}`);

  calls.length = 0;
  const capped = await p.fetch({ name: 'Valero', careers_url: GOOD }, { ...mkCtx(), maxPages: 1 });
  check(capped.length === 25 && calls.length === 2, 'taleo.fetch() honours ctx.maxPages', `jobs=${capped.length} calls=${calls.length}`);

  // empty page stops even with non-positive totalCount
  calls.length = 0;
  const noTotal = { ...mkCtx(), fetchJson: async (url, opts) => { calls.push({ kind: 'json' }); return JSON.parse(opts.body).pageNo === 1 ? { requisitionList: mkRows(2, 'z'), pagingData: { totalCount: 0 } } : { requisitionList: [] }; } };
  const nt = await p.fetch({ name: 'V', careers_url: GOOD }, noTotal);
  check(nt.length === 2 && calls.filter(c => c.kind === 'json').length === 2, 'taleo.fetch() stops on an empty page when totalCount is not positive', `jobs=${nt.length} calls=${calls.length}`);

  // no portalNo → error, no search POST
  calls.length = 0;
  let threw = '';
  try { await p.fetch({ name: 'V', careers_url: GOOD }, mkCtx('nope: 1,')); } catch (e) { threw = e.message; }
  check(/portalNo/.test(threw) && calls.length === 1, 'taleo.fetch() errors without portalNo and never POSTs', `threw="${threw}" calls=${calls.length}`);

  // SSRF
  let hits = 0;
  threw = '';
  try { await p.fetch({ name: 'Evil', careers_url: 'https://evil.test/careersection/2/jobsearch.ftl' }, { fetchText: async () => { hits++; return ''; }, fetchJson: async () => { hits++; return {}; } }); } catch (e) { threw = e.message; }
  check(/cannot derive/.test(threw) && hits === 0, 'taleo.fetch() rejects hostile careers_url before any request', `threw="${threw}" hits=${hits}`);
} catch (e) {
  fail(`taleo provider tests crashed: ${e.message}`);
}
