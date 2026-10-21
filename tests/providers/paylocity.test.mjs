// tests/providers/paylocity.test.mjs — Paylocity Recruiting provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — paylocity');

/** @param {boolean} cond @param {string} msg */
const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/paylocity.mjs')).href);
  const paylocity = mod.default;
  const { extractPaylocityJobs, parsePaylocityJobs, parsePaylocityBoardUrl } = mod;

  const GUID = '1a06dc72-45ee-4c90-a268-fe881bbeb577';
  const LISTING = `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}`;

  check(paylocity.id === 'paylocity', 'paylocity.id is "paylocity"');

  // detect
  const hit = paylocity.detect({ name: 'C', careers_url: `${LISTING}/Clover-Basin?x=1` });
  check(hit?.url === LISTING, `detect() resolves board URL (got ${JSON.stringify(hit)})`);
  check(paylocity.detect({ name: 'C', careers_url: `https://recruiting.paylocity.com/recruiting/jobs/all/${GUID.toUpperCase()}` })?.url === LISTING, 'detect() is case-insensitive on path and guid, normalizes to canonical');
  for (const [label, url] of [
    ['wrong host', `https://example.com/Recruiting/Jobs/All/${GUID}`],
    ['http scheme', `http://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}`],
    ['lookalike evil-recruiting.paylocity.com', `https://evil-recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}`],
    ['lookalike recruiting.paylocity.com.evil.io', `https://recruiting.paylocity.com.evil.io/Recruiting/Jobs/All/${GUID}`],
    ['host in path', `https://evil.example/recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}`],
    ['userinfo trick', `https://recruiting.paylocity.com@evil.example/Recruiting/Jobs/All/${GUID}`],
    ['posting URL (no board guid)', 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/3836522'],
    ['non-guid board', 'https://recruiting.paylocity.com/Recruiting/Jobs/All/not-a-guid'],
  ]) {
    check(paylocity.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }
  check(parsePaylocityBoardUrl(undefined) === null && paylocity.detect({ name: 'X', careers_url: 5 }) === null, 'non-string careers_url → null');

  // extract — real window.pageData shape, with awkward strings
  const job1 = { JobId: 3836522, JobTitle: 'Associate Veterinarian', LocationName: 'CBAH - Airport Rd.', ShouldDisplayLocation: true, PublishedDate: '2026-03-19T16:53:34-05:00', Description: 'Clover Basin', IsInternal: false, HiringDepartment: null, JobLocation: { LocationId: 1, Name: 'CBAH', City: 'Longmont', State: 'CO', Country: 'USA' }, IsRemote: false };
  const job2 = { JobId: 7, JobTitle: 'Tech [Level II] "Senior" \\ role ]', LocationName: 'Remote Worker', PublishedDate: 'nope', JobLocation: null, IsRemote: true };
  const job3 = { JobId: 8, JobTitle: 'Driver', LocationName: 'Depot 4', JobLocation: { City: '', State: '' }, IsRemote: true };
  const bad = [{ JobId: 0, JobTitle: 'Zero' }, { JobTitle: 'No id' }, { JobId: 9, JobTitle: '  ' }, null];
  const html = `<script>window.pageData = {"Departments":["All"],"Jobs":${JSON.stringify([job1, job2, job3, ...bad])},"LeadJoinUrl":"/x","Other":[1,2]};</script>`;
  const rows = extractPaylocityJobs(html);
  check(Array.isArray(rows) && rows.length === 7, `extracts the balanced Jobs array despite brackets/quotes in titles (got ${rows?.length})`);
  check(extractPaylocityJobs('<html>no data</html>') === null, 'no Jobs key → null');
  check(extractPaylocityJobs('{"Jobs":[{"JobId":1') === null, 'unterminated array → null');
  check(extractPaylocityJobs('{"Jobs":"x","Later":[1]}') === null, 'Jobs key not followed by an array → null (does not grab a later array)');
  check(Array.isArray(extractPaylocityJobs('{"Jobs":[]}')) && extractPaylocityJobs('{"Jobs":[]}').length === 0, 'empty board → [] (not null)');

  const jobs = parsePaylocityJobs(rows, 'Clover');
  const titles = jobs.map((j) => j.title);
  check(jobs.length === 3 && titles[0] === 'Associate Veterinarian' && titles[1] === 'Tech [Level II] "Senior" \\ role ]' && titles[2] === 'Driver', `parse keeps 3 valid rows, drops zero/missing id, blank title, null (got ${JSON.stringify(titles)})`);
  check(jobs[0].url === 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/3836522', 'url is the Details page for the JobId');
  check(jobs[0].location === 'Longmont, CO', `location from JobLocation City, State (got ${jobs[0].location})`);
  check(jobs[1].location === 'Remote Worker', 'LocationName used when JobLocation is null; Remote not duplicated');
  check(jobs[2].location === 'Depot 4, Remote', `IsRemote appends Remote to LocationName fallback (got ${jobs[2].location})`);
  check(jobs[0].postedAt === Date.parse('2026-03-19T16:53:34-05:00'), 'postedAt is epoch ms of PublishedDate');
  check(!('postedAt' in jobs[1]), 'unparseable PublishedDate → postedAt omitted (control)');
  check(jobs.every((j) => j.company === 'Clover' && !('description' in j) && !('salary' in j)), 'company set; truncated description and salary omitted');
  check(parsePaylocityJobs(null, 'X').length === 0 && parsePaylocityJobs({}, 'X').length === 0, 'non-array input → []');

  // fetch — request shape
  /** @type {Array<{url: string, opts: any}>} */
  const calls = [];
  const ctx = { fetchText: async (url, opts) => { calls.push({ url, opts }); return html; }, fetchJson: async () => { throw new Error('no json'); } };
  const res = await paylocity.fetch({ name: 'Clover', careers_url: `${LISTING}/Name` }, ctx);
  check(res.length === 3 && calls.length === 1 && calls[0].url === LISTING && calls[0].opts?.redirect === 'error', `fetch GETs the canonical listing once with redirect:'error' (calls=${calls.length})`);

  // page without pageData is an error, an empty board is not
  try {
    await paylocity.fetch({ name: 'X', careers_url: LISTING }, { fetchText: async () => '<html>blocked</html>' });
    fail('fetch() should throw when the listing has no Jobs array');
  } catch (e) {
    check(/no Jobs array/.test(e.message), 'fetch() throws when the listing carries no Jobs array');
  }
  const emptyBoard = await paylocity.fetch({ name: 'X', careers_url: LISTING }, { fetchText: async () => '{"Jobs":[]}' });
  check(Array.isArray(emptyBoard) && emptyBoard.length === 0, 'empty Jobs array → [] without error');

  // SSRF
  let touched = false;
  for (const badUrl of [`https://evil.example/Recruiting/Jobs/All/${GUID}`, `http://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}`, `https://169.254.169.254/Recruiting/Jobs/All/${GUID}`]) {
    try {
      await paylocity.fetch({ name: 'Bad', careers_url: badUrl }, { fetchText: async () => { touched = true; return ''; } });
      fail(`fetch() should throw for ${badUrl}`);
    } catch (e) {
      check(/paylocity: cannot derive board/.test(e.message), `fetch() rejects hostile careers_url ${badUrl}`);
    }
  }
  check(!touched, 'hostile careers_url never triggers a request');
} catch (e) {
  fail(`paylocity provider tests crashed: ${e.stack || e.message}`);
}
