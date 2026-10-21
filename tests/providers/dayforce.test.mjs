// tests/providers/dayforce.test.mjs — Dayforce career-site provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — dayforce');

/** @param {boolean} cond @param {string} msg */
const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/dayforce.mjs')).href);
  const dayforce = mod.default;
  const { parseDayforceUrl, parseDayforcePage, bootstrapCsrf } = mod;

  const API = 'https://jobs.dayforcehcm.com/api/geo/dcrusa/jobposting/search';
  const SITE = 'https://jobs.dayforcehcm.com/en-US/dcrusa/join-us';

  check(dayforce.id === 'dayforce', 'dayforce.id is "dayforce"');

  // detect
  check(dayforce.detect({ name: 'D', careers_url: SITE })?.url === API, 'detect() resolves culture/tenant/site → search API');
  check(dayforce.detect({ name: 'D', careers_url: 'https://jobs.dayforcehcm.com/dcrusa/join-us/jobs/3074?x=1' })?.url === API, 'detect() accepts culture-less posting URL');
  const fr = parseDayforceUrl('https://jobs.dayforcehcm.com/fr-CA/agfgroup/employeereferralposting');
  check(fr?.culture === 'fr-CA' && fr.tenant === 'agfgroup' && fr.site === 'employeereferralposting', `culture segment is kept (got ${JSON.stringify(fr)})`);
  const gm = parseDayforceUrl('https://jobs.dayforcehcm.com/gm/candidateportal');
  check(gm?.tenant === 'gm' && gm.site === 'candidateportal' && gm.culture === 'en-US', 'a 2-letter tenant ("gm") is not mistaken for a culture');
  for (const [label, url] of [
    ['wrong host', 'https://example.com/en-US/dcrusa/join-us'],
    ['http scheme', 'http://jobs.dayforcehcm.com/en-US/dcrusa/join-us'],
    ['lookalike evil-jobs.dayforcehcm.com', 'https://evil-jobs.dayforcehcm.com/en-US/dcrusa/join-us'],
    ['lookalike jobs.dayforcehcm.com.evil.io', 'https://jobs.dayforcehcm.com.evil.io/en-US/dcrusa/join-us'],
    ['host in path', 'https://evil.example/jobs.dayforcehcm.com/en-US/dcrusa/join-us'],
    ['userinfo trick', 'https://jobs.dayforcehcm.com@evil.example/en-US/dcrusa/join-us'],
    ['tenant without site', 'https://jobs.dayforcehcm.com/en-US/dcrusa'],
    ['locale only', 'https://jobs.dayforcehcm.com/en-US'],
    ['platform api path', 'https://jobs.dayforcehcm.com/api/geo/dcrusa/jobposting/search'],
    ['_next bundle', 'https://jobs.dayforcehcm.com/en-US/_next/data/build/dcrusa.json'],
    ['traversal-ish tenant', 'https://jobs.dayforcehcm.com/en-US/a%2e%2e/join-us'],
  ]) {
    check(dayforce.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }
  check(dayforce.detect({ name: 'X', careers_url: null }) === null, 'detect() null for non-string careers_url');

  // parse — shaped like the live search response
  const board = parseDayforceUrl(SITE);
  const page = {
    maxCount: 4,
    jobPostings: [
      { jobPostingId: 3074, jobTitle: ' CDL Driver ', jobDescription: 'Drive trucks.\n&nbsp;\nYou Will:\nLoad &amp; unload carts.', hasVirtualLocation: false, postingStartTimestampUTC: '2026-10-19T07:00:00+00:00',
        postingLocations: [{ cityName: 'Brisbane', stateCode: 'CA', isoCountryCode: 'US' }, { cityName: 'Brisbane', stateCode: 'CA', isoCountryCode: 'US' }, { cityName: 'Reno', stateCode: 'NV', isoCountryCode: 'US' }] },
      { jobPostingId: 3075, jobTitle: 'Remote Planner', jobDescription: '', hasVirtualLocation: true, postingStartTimestampUTC: null, postingLocations: null },
      { jobPostingId: 0, jobTitle: 'Zero id' },
      { jobTitle: 'No id' },
      { jobPostingId: 5, jobTitle: '  ' },
    ],
  };
  const jobs = parseDayforcePage(page, board, 'dnata');
  check(jobs.length === 2 && jobs[0].title === 'CDL Driver' && jobs[1].title === 'Remote Planner', `parse keeps 2 valid rows, drops zero/missing id and blank title (got ${jobs.map((j) => j.title).join('|')})`);
  check(jobs[0].url === 'https://jobs.dayforcehcm.com/en-US/dcrusa/join-us/jobs/3074', 'url is culture/tenant/site/jobs/<id>');
  check(jobs[0].location === 'Brisbane, CA, US; Reno, NV, US', `locations deduped and joined by "; " (got ${jobs[0].location})`);
  check(jobs[1].location === 'Remote', 'virtual-only posting → Remote');
  check(jobs[0].description === 'Drive trucks.\n \nYou Will:\nLoad & unload carts.', `description entities decoded (got ${JSON.stringify(jobs[0].description)})`);
  check(!('description' in jobs[1]), 'empty description omitted (control)');
  check(jobs[0].postedAt === Date.parse('2026-10-19T07:00:00+00:00') && !('postedAt' in jobs[1]), 'postedAt from postingStartTimestampUTC; null → omitted');
  check(jobs.every((j) => j.company === 'dnata' && !('salary' in j)), 'company set; salary omitted');
  check(parseDayforcePage({}, board, 'X').length === 0 && parseDayforcePage({ jobPostings: 'x' }, board, 'X').length === 0, 'malformed payloads → []');

  // bootstrapCsrf
  const okRes = (token = 'tok', cookies = ['__Host-next-auth.csrf-token=tok|hash; Path=/; Secure', '__cf_bm=zzz; Path=/']) => ({
    ok: true, status: 200, json: async () => ({ csrfToken: token }), headers: { getSetCookie: () => cookies },
  });
  const pair = await bootstrapCsrf(async () => okRes());
  check(pair.token === 'tok' && pair.cookie === '__Host-next-auth.csrf-token=tok|hash', 'bootstrapCsrf returns token + only the csrf cookie pair');
  let threw = false;
  try { await bootstrapCsrf(async () => okRes('tok', ['__cf_bm=zzz'])); } catch { threw = true; }
  check(threw, 'bootstrapCsrf throws when the csrf cookie is missing');
  threw = false;
  try { await bootstrapCsrf(async () => ({ ok: false, status: 503, headers: {} })); } catch { threw = true; }
  check(threw, 'bootstrapCsrf throws on a non-OK response');

  // fetch — pagination by maxCount, csrf header+cookie, redirect:'error'
  /** @type {Array<{url: string, opts: any}>} */
  const calls = [];
  /** @type {Array<{url: string, opts: any}>} */
  const csrfCalls = [];
  /** @type {number[]} */
  const slept = [];
  let minted = 0;
  const posting = (i) => ({ jobPostingId: 100 + i, jobTitle: `Role ${i}`, jobDescription: 'd', postingLocations: [] });
  const baseCtx = {
    sleep: async (ms) => { slept.push(ms); },
    fetchResponse: async (url, opts) => { csrfCalls.push({ url, opts }); minted++; return okRes(`tok${minted}`, [`__Host-next-auth.csrf-token=tok${minted}|h; Path=/`]); },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const start = JSON.parse(opts.body).paginationStart;
      const n = Math.max(0, Math.min(25, 60 - start));
      return { maxCount: 60, jobPostings: Array.from({ length: n }, (_, i) => posting(start + i)) };
    },
  };
  const entry = { name: 'DCR', careers_url: SITE };
  const all = await dayforce.fetch(entry, { ...baseCtx, maxPages: 10 });
  check(all.length === 60 && calls.length === 3, `fetch pages 25+25+10 until maxCount (jobs=${all.length}, calls=${calls.length})`);
  check(calls.map((c) => JSON.parse(c.opts.body).paginationStart).join(',') === '0,25,50', 'paginationStart advances by 25');
  check(calls.every((c) => c.url === API && c.opts.method === 'POST' && c.opts.redirect === 'error'), "every search is POST to the tenant API with redirect:'error'");
  check(calls.every((c) => c.opts.headers['x-csrf-token'] === 'tok1' && c.opts.headers.cookie === '__Host-next-auth.csrf-token=tok1|h'), 'csrf token header and cookie sent on every page');
  const body0 = JSON.parse(calls[0].opts.body);
  check(body0.clientNamespace === 'dcrusa' && body0.jobBoardCode === 'join-us' && body0.cultureCode === 'en-US', 'body carries tenant, site and culture');
  check(csrfCalls.length === 1 && csrfCalls[0].url === 'https://jobs.dayforcehcm.com/api/auth/csrf' && csrfCalls[0].opts.redirect === 'error', "csrf bootstrapped once from the fixed host with redirect:'error'");
  check(slept.length === 2, `sleeps between pages only (${slept.length})`);

  calls.length = 0;
  const capped = await dayforce.fetch(entry, { ...baseCtx, maxPages: 1 });
  check(capped.length === 25 && calls.length === 1, 'ctx.maxPages:1 stops after one page');
  calls.length = 0;
  await dayforce.fetch(entry, {
    ...baseCtx,
    fetchJson: async (url, opts) => { calls.push({ url, opts }); return { maxCount: 99999, jobPostings: [posting(calls.length)] }; },
  });
  check(calls.length === 5, `default cap is 5 pages (calls=${calls.length})`);

  // stale csrf: 403 on the first page re-mints once and retries; persistent 403 throws
  calls.length = 0; minted = 0;
  const ctx403 = {
    ...baseCtx,
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      if (opts.headers['x-csrf-token'] === 'tok1') { const e = new Error('HTTP 403'); e.status = 403; throw e; }
      return { maxCount: 1, jobPostings: [posting(0)] };
    },
  };
  const recovered = await dayforce.fetch(entry, ctx403);
  check(recovered.length === 1 && minted === 2 && calls.length === 2 && calls[1].opts.headers['x-csrf-token'] === 'tok2', 'first-page 403 re-mints the csrf pair once and retries');
  try {
    await dayforce.fetch(entry, { ...baseCtx, fetchJson: async () => { const e = new Error('HTTP 403'); e.status = 403; throw e; } });
    fail('a persistent 403 should surface');
  } catch (e) {
    check(e.status === 403, 'persistent 403 propagates (one retry only)');
  }
  try {
    await dayforce.fetch(entry, { ...baseCtx, fetchJson: async () => { const e = new Error('HTTP 500'); e.status = 500; throw e; } });
    fail('a 500 should surface');
  } catch (e) {
    check(e.status === 500, 'non-403 errors are not retried (control)');
  }

  const empty = await dayforce.fetch(entry, { ...baseCtx, fetchJson: async () => ({ maxCount: 0, jobPostings: [] }) });
  check(Array.isArray(empty) && empty.length === 0, 'empty board → []');

  // SSRF: hostile careers_url throws before the csrf bootstrap or any request
  let touched = false;
  const spyCtx = {
    fetchResponse: async () => { touched = true; return okRes(); },
    fetchJson: async () => { touched = true; return {}; },
  };
  for (const bad of ['https://evil.example/en-US/dcrusa/join-us', 'http://jobs.dayforcehcm.com/en-US/dcrusa/join-us', 'https://169.254.169.254/en-US/dcrusa/join-us']) {
    try {
      await dayforce.fetch({ name: 'Bad', careers_url: bad }, spyCtx);
      fail(`fetch() should throw for ${bad}`);
    } catch (e) {
      check(/dayforce: cannot derive board/.test(e.message), `fetch() rejects hostile careers_url ${bad}`);
    }
  }
  check(!touched, 'hostile careers_url never triggers csrf bootstrap or a search request');
} catch (e) {
  fail(`dayforce provider tests crashed: ${e.stack || e.message}`);
}
