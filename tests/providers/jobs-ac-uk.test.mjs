// tests/providers/jobs-ac-uk.test.mjs — fixture is three real cards + pager from
// https://www.jobs.ac.uk/search/?keywords=computer+science&sortOrder=1 (2026-10-22), trimmed.
import { pass, fail, ROOT } from '../helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jobs-ac-uk');

const mod = await import(pathToFileURL(join(ROOT, 'providers/jobs-ac-uk.mjs')).href);
const provider = mod.default;
const { parseSearchPage, inferPostedAt, buildSearchUrl, parseJobsAcUkConfig } = mod;
const html = readFileSync(join(ROOT, 'tests/providers/fixtures/jobs-ac-uk-search.html'), 'utf-8');

function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass(label);
  else fail(`${label}: got ${g}, want ${w}`);
}

// ── detect ───────────────────────────────────────────────────────────────
eq('detect claims the explicit provider id', provider.detect({ provider: 'jobs-ac-uk' })?.url, 'https://www.jobs.ac.uk/search/');
eq('control: detect ignores other providers and bare careers_url', [provider.detect({ provider: 'higheredjobs' }), provider.detect({ careers_url: 'https://www.jobs.ac.uk/' })], [null, null]);

// ── parse real cards ─────────────────────────────────────────────────────
const now = Date.UTC(2026, 9, 22, 12);
const page = parseSearchPage(html, now);
eq('three cards parsed, pager read', [page.jobs.length, page.page, page.pages], [3, 1, 13]);
eq('first card: title, url, employer, location', [page.jobs[0].title, page.jobs[0].url, page.jobs[0].company, page.jobs[0].location], [
  'Programmes Assistant', 'https://www.jobs.ac.uk/job/DTJ539/programmes-assistant', 'University of Warwick', 'Coventry, University of Warwick, Hybrid',
]);
eq('first card: "22 Oct" becomes 2026-10-22 UTC', page.jobs[0].postedAt, Date.UTC(2026, 9, 22));
eq('control: a title with a colon and a hyphenated phrase survives intact', page.jobs[1].title.startsWith('PhD Studentship: Watching a fungus fight back'), true);

// ── hostile / malformed cards are dropped ────────────────────────────────
const card = (href, title = 'T') => `<div class="j-search-result__result"><a href="${href}">${title}</a><div class="j-search-result__employer"><b>E</b></div></div>`;
const hostile = parseSearchPage([
  card('/job/AAA111/ok'),
  card('https://evil.example/job/AAA111/x'),
  card('//evil.example/job/AAA111/x'),
  card('/job/AAA111/../../etc'),
  card('/job/feedback/'),
  card('/job/feedback/x'),
  card('/job/AAA111/..'),
  card('javascript:alert(1)'),
  card('/job/BBB222/blank-title', '  '),
].join(''));
eq('only the well-formed /job/<id>/<slug> card on www.jobs.ac.uk survives', hostile.jobs.map((j) => j.url), ['https://www.jobs.ac.uk/job/AAA111/ok']);
eq('control: that card has no date, so no postedAt', 'postedAt' in hostile.jobs[0], false);
eq('non-string input returns an empty page', parseSearchPage(undefined).jobs, []);

// ── year inference ───────────────────────────────────────────────────────
eq('a past day in the current year keeps the year', inferPostedAt('21 Oct', now), Date.UTC(2026, 9, 21));
eq('control: a month still ahead rolls back to last year', inferPostedAt('15 Dec', now), Date.UTC(2025, 11, 15));
eq('impossible dates are rejected', [inferPostedAt('31 Feb', now), inferPostedAt('soon', now), inferPostedAt('', now)], [undefined, undefined, undefined]);

// ── URL + config ─────────────────────────────────────────────────────────
eq('page 1 has no startIndex, sorted newest', buildSearchUrl('computer science', 1), 'https://www.jobs.ac.uk/search/?keywords=computer+science&sortOrder=1');
eq('page 3 starts at record 51', buildSearchUrl('physics', 3), 'https://www.jobs.ac.uk/search/?keywords=physics&sortOrder=1&startIndex=51');
eq('empty keyword means no keywords param', buildSearchUrl('', 1), 'https://www.jobs.ac.uk/search/?sortOrder=1');
eq('config: keywords trimmed + deduped, max_pages clamped', parseJobsAcUkConfig({ jobs_ac_uk: { keywords: [' a ', 'a', '', 3], max_pages: 99 } }), { keywords: ['a'], maxPages: 10 });
eq('control: defaults when the block is absent', parseJobsAcUkConfig({}), { keywords: [], maxPages: 3 });

// ── fetch: paging, dedup, outage ─────────────────────────────────────────
const fullPage = (n, of, from) => {
  const cards = Array.from({ length: n }, (_, i) => card(`/job/P${from + i}XX/job-${from + i}`, `Job ${from + i}`)).join('');
  return `${cards}<span> Page ${Math.floor((from - 1) / 25) + 1} of ${of} >> </span>`;
};
{
  const urls = [];
  const ctx = {
    sleep: async () => {},
    fetchText: async (url, opts) => {
      urls.push(url);
      eq('every request is pinned with redirect:error', opts.redirect, 'error');
      return url.includes('startIndex=26') ? fullPage(3, 2, 26) : fullPage(25, 2, 1);
    },
  };
  const jobs = await provider.fetch({ name: 'jobs.ac.uk', provider: 'jobs-ac-uk', jobs_ac_uk: { keywords: ['x'], max_pages: 5 } }, ctx);
  eq('a full page 1 + short page 2 yields 28 jobs and stops at the last page', [jobs.length, urls.length], [28, 2]);
}
{
  const ctx = { sleep: async () => {}, fetchText: async () => fullPage(25, 9, 1) };
  const jobs = await provider.fetch({ name: 'j', provider: 'jobs-ac-uk', jobs_ac_uk: { keywords: ['a', 'b'], max_pages: 3 } }, ctx);
  eq('control: the same 25 jobs from two keywords and three pages are deduped by URL', jobs.length, 25);
}
{
  let calls = 0;
  const ctx = { sleep: async () => {}, maxPages: 1, fetchText: async () => { calls++; return fullPage(25, 9, 1); } };
  await provider.fetch({ name: 'j', provider: 'jobs-ac-uk', jobs_ac_uk: { keywords: ['a'], max_pages: 5 } }, ctx);
  eq('ctx.maxPages (the health probe) caps paging at one request', calls, 1);
}
{
  const ctx = { sleep: async () => {}, fetchText: async () => { throw new Error('HTTP 503'); } };
  let msg = '';
  try { await provider.fetch({ name: 'j', provider: 'jobs-ac-uk', jobs_ac_uk: { keywords: ['a'] } }, ctx); } catch (e) { msg = e.message; }
  eq('a total outage throws, naming the cause', msg.includes('HTTP 503'), true);
}
{
  const ctx = { sleep: async () => {}, fetchText: async () => '<html>no results</html>' };
  const jobs = await provider.fetch({ name: 'j', provider: 'jobs-ac-uk', jobs_ac_uk: { keywords: ['zzzqqq'] } }, ctx);
  eq('control: zero results is an empty list, not an outage', jobs, []);
}
