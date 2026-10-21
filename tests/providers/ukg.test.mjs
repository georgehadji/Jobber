// tests/providers/ukg.test.mjs — UKG Pro Recruiting (UltiPro) provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — ukg');

/** @param {boolean} cond @param {string} msg */
const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/ukg.mjs')).href);
  const ukg = mod.default;
  const { parseUkgPage, parseUkgBoardUrl } = mod;

  const GUID = 'a46cbdaa-ca2c-49b6-8d2b-e0ceaafa0e25';
  const BOARD = `https://recruiting.ultipro.com/van5000vcscu/JobBoard/${GUID}`;
  const API = `${BOARD}/JobBoardView/LoadSearchResults`;

  check(ukg.id === 'ukg', 'ukg.id is "ukg"');

  // detect — positives (each host family) and control negatives
  const hit = ukg.detect({ name: 'V', careers_url: `${BOARD}/?q=&o=postedDateDesc` });
  check(hit?.url === API, `detect() resolves board URL → LoadSearchResults (got ${JSON.stringify(hit)})`);
  check(ukg.detect({ name: 'V', careers_url: `https://recruiting2.ultipro.ca/bur5000/JobBoard/${GUID}/OpportunityDetail?opportunityId=x` })?.url
    === `https://recruiting2.ultipro.ca/bur5000/JobBoard/${GUID}/JobBoardView/LoadSearchResults`, 'detect() accepts *.ultipro.ca');
  check(ukg.detect({ name: 'V', careers_url: `https://acme.rec.pro.ukg.net/ACM1000/JobBoard/${GUID}` })?.url
    === `https://acme.rec.pro.ukg.net/ACM1000/JobBoard/${GUID}/JobBoardView/LoadSearchResults`, 'detect() accepts *.rec.pro.ukg.net');
  for (const [label, url] of [
    ['wrong host', `https://example.com/t/JobBoard/${GUID}`],
    ['http scheme', `http://recruiting.ultipro.com/t/JobBoard/${GUID}`],
    ['lookalike evil-ultipro.com', `https://evil-ultipro.com/t/JobBoard/${GUID}`],
    ['lookalike ultipro.com.evil.io', `https://recruiting.ultipro.com.evil.io/t/JobBoard/${GUID}`],
    ['host in path', `https://evil.example/recruiting.ultipro.com/t/JobBoard/${GUID}`],
    ['userinfo trick', `https://recruiting.ultipro.com@evil.example/t/JobBoard/${GUID}`],
    ['no JobBoard segment', 'https://recruiting.ultipro.com/t/Other/x'],
    ['non-guid board', 'https://recruiting.ultipro.com/t/JobBoard/not-a-guid'],
  ]) {
    check(ukg.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }
  check(ukg.detect({ name: 'X', careers_url: null }) === null && ukg.detect({ name: 'X' }) === null, 'detect() null for missing/non-string careers_url');

  // parseUkgPage — payload shaped like the live LoadSearchResults response
  const board = parseUkgBoardUrl(BOARD);
  const page = {
    totalCount: 5,
    opportunities: [
      { Id: 'id-1', Title: 'Senior Analyst', PostedDate: '2026-10-20T23:57:12.365Z', BriefDescription: 'teaser',
        Locations: [{ LocalizedName: 'Vancity Centre', Address: { City: 'Vancouver', State: { Code: 'BC', Name: 'British Columbia' }, Country: { Code: 'CAN', Name: 'Canada' } } }] },
      { Id: 'id-2', Title: 'Data Analyst', PostedDate: 'garbage', Locations: [{ LocalizedName: 'Remote - US', Address: null }] },
      { Id: 'id-3', Title: 'No Location', Locations: [] },
      { Id: '', Title: 'Blank id' },
      { Id: 'id-5', Title: '   ' },
      null,
    ],
  };
  const jobs = parseUkgPage(page, board, 'Acme');
  const titles = jobs.map((j) => j.title).join('|');
  check(jobs.length === 3 && titles === 'Senior Analyst|Data Analyst|No Location', `parse keeps the 3 valid rows by title, drops blank id/title/null (got ${titles})`);
  check(jobs[0].location === 'Vancouver, British Columbia, Canada', `structured location joined (got ${jobs[0].location})`);
  check(jobs[1].location === 'Remote - US', 'location falls back to LocalizedName when Address is null');
  check(jobs[2].location === '', 'no Locations → empty location');
  check(jobs[0].url === `${BOARD}/OpportunityDetail?opportunityId=id-1`, 'url is the OpportunityDetail page');
  check(jobs[0].postedAt === Date.parse('2026-10-20T23:57:12.365Z'), 'postedAt is epoch ms of PostedDate');
  check(!('postedAt' in jobs[1]), 'unparseable PostedDate → postedAt omitted (control)');
  check(jobs.every((j) => j.company === 'Acme' && !('description' in j) && !('salary' in j)), 'company set; teaser description and salary omitted');
  check(parseUkgPage({}, board, 'X').length === 0 && parseUkgPage({ opportunities: null }, board, 'X').length === 0, 'malformed payloads → []');

  // fetch — pagination via totalCount, request shape, redirect:'error'
  /** @type {Array<{url: string, opts: any}>} */
  const calls = [];
  /** @type {number[]} */
  const slept = [];
  const mk = (n, off) => ({ totalCount: 250, opportunities: Array.from({ length: n }, (_, i) => ({ Id: `p${off + i}`, Title: `Role ${off + i}` })) });
  const ctx = {
    sleep: async (ms) => { slept.push(ms); },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const skip = JSON.parse(opts.body).opportunitySearch.Skip;
      return skip >= 250 ? { totalCount: 250, opportunities: [] } : mk(Math.min(100, 250 - skip), skip);
    },
  };
  const entry = { name: 'Vancity', careers_url: BOARD };
  const all = await ukg.fetch(entry, { ...ctx, maxPages: 10 });
  check(all.length === 250 && calls.length === 3, `fetch pages 100+100+50 until totalCount (jobs=${all.length}, calls=${calls.length})`);
  check(calls.every((c) => c.url === API && c.opts.method === 'POST' && c.opts.redirect === 'error'), "every request is POST to LoadSearchResults with redirect:'error'");
  check(calls.map((c) => JSON.parse(c.opts.body).opportunitySearch.Skip).join(',') === '0,100,200', 'Skip advances by rows received');
  check(slept.length === 2, `sleeps between pages only (${slept.length})`);
  check(new Set(all.map((j) => j.url)).size === 250, 'all job urls distinct');

  calls.length = 0;
  const capped = await ukg.fetch(entry, { ...ctx, maxPages: 1 });
  check(capped.length === 100 && calls.length === 1, `ctx.maxPages:1 stops after one page (calls=${calls.length})`);
  calls.length = 0;
  await ukg.fetch({ ...entry, max_pages: 2 }, ctx);
  check(calls.length === 2, `entry.max_pages:2 honoured (calls=${calls.length})`);
  calls.length = 0;
  // A server that always claims more rows than it returns must still stop at the default cap.
  await ukg.fetch(entry, {
    sleep: async () => {},
    fetchJson: async (u, o) => { calls.push({ url: u, opts: o }); return { totalCount: 99999, opportunities: [{ Id: `x${calls.length}`, Title: 'T' }] }; },
  });
  check(calls.length === 5, `default cap is 5 pages when totalCount is never reached (calls=${calls.length})`);

  const empty = await ukg.fetch(entry, { sleep: async () => {}, fetchJson: async () => ({ totalCount: 0, opportunities: [] }) });
  check(Array.isArray(empty) && empty.length === 0, 'empty board → []');

  // SSRF: hostile careers_url never reaches ctx.fetchJson
  let touched = false;
  for (const bad of [`https://evil.example/t/JobBoard/${GUID}`, `http://recruiting.ultipro.com/t/JobBoard/${GUID}`, `https://169.254.169.254/t/JobBoard/${GUID}`]) {
    try {
      await ukg.fetch({ name: 'Bad', careers_url: bad }, { fetchJson: async () => { touched = true; return {}; } });
      fail(`fetch() should throw for ${bad}`);
    } catch (e) {
      check(/ukg: cannot derive board/.test(e.message), `fetch() rejects hostile careers_url ${bad}`);
    }
  }
  check(!touched, 'hostile careers_url never triggers a request');
} catch (e) {
  fail(`ukg provider tests crashed: ${e.stack || e.message}`);
}
