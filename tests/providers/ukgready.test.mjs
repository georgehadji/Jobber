// tests/providers/ukgready.test.mjs — UKG Ready (SaaSHR / Kronos Workforce Ready) provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — ukgready');

/** @param {boolean} cond @param {string} msg */
const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/ukgready.mjs')).href);
  const ukgready = mod.default;
  const { parseUkgReadyRows, ukgReadySalary, parseUkgReadyUrl } = mod;

  const CAREERS = 'https://secure.entertimeonline.com/ta/10284.careers';
  const LIST = 'https://secure.entertimeonline.com/ta/rest/ui/recruitment/companies/%7C10284/job-requisitions';
  const SETTINGS = 'https://secure.entertimeonline.com/ta/rest/ui/bootstrap/companies/%7C10284/format-settings';

  check(ukgready.id === 'ukgready', 'ukgready.id is "ukgready"');

  // detect
  const hit = ukgready.detect({ name: 'S', careers_url: `${CAREERS}?ShowJob=738775745` });
  check(hit?.url === LIST, `detect() resolves careers page → job-requisitions API (got ${JSON.stringify(hit)})`);
  for (const host of ['secure4.saashr.com', 'secure2.yourpayrollhr.com', 'aus-secure.prd.mykronos.com', 'secure.workforceready.com.au', 'secure.workforceready.eu']) {
    check(ukgready.detect({ name: 'S', careers_url: `https://${host}/ta/6162397.careers` })?.url
      === `https://${host}/ta/rest/ui/recruitment/companies/%7C6162397/job-requisitions`, `detect() accepts ${host}`);
  }
  check(parseUkgReadyUrl('https://secure.saashr.com/ta/ABC123.careers')?.tenant === 'abc123', 'tenant is lower-cased');
  for (const [label, url] of [
    ['wrong host', 'https://example.com/ta/10284.careers'],
    ['http scheme', 'http://secure.saashr.com/ta/10284.careers'],
    ['lookalike evil-saashr.com', 'https://evil-saashr.com/ta/10284.careers'],
    ['lookalike saashr.com.evil.io', 'https://secure.saashr.com.evil.io/ta/10284.careers'],
    ['bare apex saashr.com', 'https://saashr.com/ta/10284.careers'],
    ['host in path', 'https://evil.example/secure.saashr.com/ta/10284.careers'],
    ['userinfo trick', 'https://secure.saashr.com@evil.example/ta/10284.careers'],
    ['REST api path is not a board', 'https://secure.saashr.com/ta/rest/ui/recruitment/companies/%7C10284/job-requisitions'],
    ['missing .careers suffix', 'https://secure.saashr.com/ta/10284'],
    ['tenant with path chars', 'https://secure.saashr.com/ta/a%2Fb.careers'],
  ]) {
    check(ukgready.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }
  check(ukgready.detect({ name: 'X', careers_url: 7 }) === null, 'detect() null for non-string careers_url');

  // salary annualization — each period plus the control (unknown period / currency / zero)
  check(JSON.stringify(ukgReadySalary({ base_pay_from: 32.5, base_pay_to: 41, base_pay_frequency: 'HOUR' }, 'USD')) === JSON.stringify({ min: 67600, max: 85280, currency: 'USD' }), 'HOUR × 2080');
  check(ukgReadySalary({ base_pay_from: 5000, base_pay_frequency: 'month' }, 'usd')?.min === 60000, 'MONTH × 12, period case-insensitive');
  check(ukgReadySalary({ base_pay_from: 1200, base_pay_to: 1400, base_pay_frequency: 'WEEK' }, 'AUD')?.max === 72800, 'WEEK × 52');
  check(ukgReadySalary({ base_pay_from: 90000, base_pay_to: 110000, base_pay_frequency: 'YEAR' }, 'USD')?.min === 90000, 'YEAR × 1');
  const oneSided = ukgReadySalary({ base_pay_from: 16, base_pay_frequency: 'HOUR' }, 'USD');
  check(oneSided && oneSided.min === 33280 && oneSided.max === null && 'max' in oneSided && oneSided.currency === 'USD', 'one-sided range keeps all three keys, unknown bound is null');
  check(ukgReadySalary({ base_pay_from: 16, base_pay_frequency: 'DAILY' }, 'USD') === undefined, 'unknown period → salary omitted');
  check(ukgReadySalary({ base_pay_from: 16, base_pay_frequency: 'HOUR' }, '') === undefined, 'unknown currency → salary omitted');
  check(ukgReadySalary({ base_pay_from: 0, base_pay_to: 0, base_pay_frequency: 'YEAR' }, 'USD') === undefined, 'zero bounds → salary omitted (never 0)');
  check(ukgReadySalary({ base_pay_frequency: 'YEAR' }, 'USD') === undefined, 'no bounds → salary omitted');

  // rows — shaped like the live job_requisitions payload
  const board = parseUkgReadyUrl(CAREERS);
  const rows = [
    { id: 738775745, job_title: 'Full-Time Sales Associate- Joplin', location: { country: 'USA', city: 'Joplin', state: 'MO', zip: '64801' }, base_pay_from: 16, base_pay_frequency: 'HOUR', job_description: 'preview…', is_remote_job: false },
    { id: 2, job_title: 'Remote Analyst', location: { country: 'USA', city: '', state: '' }, base_pay_from: 90000, base_pay_to: 100000, base_pay_frequency: 'YEAR', is_remote_job: true },
    { id: 3, job_title: 'No Pay', location: {}, base_pay_frequency: 'YEAR' },
    { id: 0, job_title: 'Zero id' },
    { job_title: 'No id' },
    { id: 6, job_title: '  ' },
    null,
  ];
  const jobs = parseUkgReadyRows(rows, board, 'Acme', 'USD');
  const titles = jobs.map((j) => j.title).join('|');
  check(titles === 'Full-Time Sales Associate- Joplin|Remote Analyst|No Pay', `keeps valid rows, drops no-id/blank-title/null (got ${titles})`);
  check(jobs[0].url === 'https://secure.entertimeonline.com/ta/10284.careers?ShowJob=738775745', 'url is the SPA ShowJob route');
  check(jobs[0].location === 'Joplin, MO, USA', `location City, State, Country (got ${jobs[0].location})`);
  check(jobs[1].location === 'USA, Remote', `is_remote_job appends Remote (got ${jobs[1].location})`);
  check(jobs[0].salary?.min === 33280 && jobs[1].salary?.max === 100000 && !('salary' in jobs[2]), 'salary populated only where pay is stated');
  check(jobs.every((j) => !('description' in j) && !('postedAt' in j)), 'preview description and postedAt omitted (UKG Ready exposes no date)');
  check(!('salary' in parseUkgReadyRows([rows[0]], board, 'Acme', '')[0]), 'no currency → salary dropped (control)');

  // fetch — request shape, page-number pagination, settings only when pay is stated
  /** @type {Array<{url: string, opts: any}>} */
  const calls = [];
  /** @type {number[]} */
  const slept = [];
  const row = (i) => ({ id: 1000 + i, job_title: `Role ${i}`, location: { city: 'X', country: 'USA' }, base_pay_from: 20, base_pay_frequency: 'HOUR' });
  const ctx = {
    sleep: async (ms) => { slept.push(ms); },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      if (url === SETTINGS) return { locale: { currency_code: 'USD' } };
      const page = Number(new URL(url).searchParams.get('offset'));
      const pages = { 1: [row(1), row(2)], 2: [row(3)], 3: [] };
      return { job_requisitions: pages[page] ?? [], _paging: { offset: page, size: 200, total: 3 } };
    },
  };
  const entry = { name: 'Shoes', careers_url: CAREERS };
  const res = await ukgready.fetch(entry, ctx);
  const listCalls = calls.filter((c) => c.url.startsWith(LIST));
  check(res.length === 3 && res[0].salary?.currency === 'USD', `fetch returns 3 jobs with currency from format-settings (jobs=${res.length})`);
  check(listCalls.map((c) => new URL(c.url).searchParams.get('offset')).join(',') === '1,2', 'offset is a 1-based page number; stops once _paging.total reached');
  check(listCalls.every((c) => new URL(c.url).searchParams.get('size') === '200'), 'size=200');
  check(calls.every((c) => c.opts?.redirect === 'error'), "every request (list and settings) passes redirect:'error'");
  check(calls.filter((c) => c.url === SETTINGS).length === 1, 'format-settings fetched exactly once when pay is stated');
  check(slept.length === 1, `sleeps between list pages only (${slept.length})`);

  calls.length = 0;
  const capped = await ukgready.fetch(entry, { ...ctx, maxPages: 1 });
  check(capped.length === 2 && calls.filter((c) => c.url.startsWith(LIST)).length === 1, 'ctx.maxPages:1 stops after the first list page');

  calls.length = 0;
  await ukgready.fetch(entry, {
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      return url === SETTINGS ? {} : { job_requisitions: [{ id: 1, job_title: 'No Pay Role', base_pay_frequency: 'YEAR' }], _paging: { total: 1 } };
    },
  });
  check(!calls.some((c) => c.url === SETTINGS), 'format-settings NOT fetched when no posting states pay (control)');

  // settings failure degrades to no salary, never fails the scan
  const degraded = await ukgready.fetch(entry, {
    sleep: async () => {},
    fetchJson: async (url) => {
      if (url === SETTINGS) throw new Error('boom');
      return { job_requisitions: [row(1)], _paging: { total: 1 } };
    },
  });
  check(degraded.length === 1 && !('salary' in degraded[0]), 'settings request failure → jobs kept, salary dropped');

  // runaway server: default cap
  calls.length = 0;
  await ukgready.fetch(entry, {
    sleep: async () => {},
    fetchJson: async (url, opts) => { calls.push({ url, opts }); return url === SETTINGS ? {} : { job_requisitions: [{ id: calls.length, job_title: 'T' }], _paging: { total: 99999 } }; },
  });
  check(calls.length === 5, `default cap is 5 pages (calls=${calls.length})`);

  // SSRF
  let touched = false;
  for (const bad of ['https://evil.example/ta/10284.careers', 'http://secure.saashr.com/ta/10284.careers', 'https://169.254.169.254/ta/10284.careers']) {
    try {
      await ukgready.fetch({ name: 'Bad', careers_url: bad }, { fetchJson: async () => { touched = true; return {}; } });
      fail(`fetch() should throw for ${bad}`);
    } catch (e) {
      check(/ukgready: cannot derive board/.test(e.message), `fetch() rejects hostile careers_url ${bad}`);
    }
  }
  check(!touched, 'hostile careers_url never triggers a request');
} catch (e) {
  fail(`ukgready provider tests crashed: ${e.stack || e.message}`);
}
