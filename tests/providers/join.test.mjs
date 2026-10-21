// tests/providers/join.test.mjs — fixtures shaped like live join.com payloads (justhiringde / id 167291, 2026-10-21).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — join');
const ok = (c, m) => (c ? pass(m) : fail(m));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/join.mjs')).href);
  const p = mod.default;
  ok(p.id === 'join', 'join.id is "join"');

  ok(p.detect({ name: 'JH', careers_url: 'https://join.com/companies/justhiringde' })?.url === 'https://join.com/companies/justhiringde', 'detect() company page URL');
  ok(p.detect({ name: 'JH', careers_url: 'https://join.com/companies/justhiringde/16797130-online-marketing-manager' })?.url === 'https://join.com/companies/justhiringde', 'detect() job URL -> company page');
  ok(p.detect({ name: 'JH', careers_url: 'https://www.join.com/companies/justhiringde' }) !== null, 'detect() accepts www.join.com');
  ok(p.detect({ name: 'X', careers_url: 'http://join.com/companies/justhiringde' }) === null, 'detect() rejects http');
  ok(p.detect({ name: 'X', careers_url: 'https://evil-join.com/companies/justhiringde' }) === null, 'detect() rejects lookalike evil-join.com');
  ok(p.detect({ name: 'X', careers_url: 'https://join.com.evil.example/companies/justhiringde' }) === null, 'detect() rejects suffix-spoofed host');
  ok(p.detect({ name: 'X', careers_url: 'https://evil.example/join.com/companies/justhiringde' }) === null, 'detect() rejects path-spoofed URL');
  ok(p.detect({ name: 'X', careers_url: 'https://join.com/about' }) === null, 'detect() null for non-company path');
  ok(p.detect({ name: 'X', careers_url: undefined }) === null, 'detect() null for missing careers_url');

  // company page parser
  const pageHtml = '<script>{"x":1,"company":{"id":167291,"name":"Just \\"Hiring\\"","domain":"justhiringde","desc":"..."}}</script>';
  const co = mod.parseCompanyPage(pageHtml);
  ok(co?.id === 167291 && co?.domain === 'justhiringde', 'parseCompanyPage extracts id + domain (name with escaped quotes)');
  ok(mod.parseCompanyPage('<html>no data</html>') === null && mod.parseCompanyPage(null) === null, 'parseCompanyPage -> null when absent');

  // list page parser
  const item = {
    id: 16797130, idParam: '16797130-online-marketing-manager-m-w-d-im-homeoffice', title: 'Online Marketing Manager',
    createdAt: '2026-10-07T10:51:51.523Z', salaryFrequency: 'PER_YEAR',
    salaryAmountFrom: { amount: 6000000, currency: 'EUR' }, salaryAmountTo: { amount: 10000000, currency: 'EUR' },
    settings: { showSalary: true }, workplaceType: 'REMOTE',
    city: { cityName: 'Berlin', countryName: 'Germany' }, country: { name: 'Germany' },
  };
  const page1 = {
    items: [
      item,
      { id: 2, idParam: '2-plain', title: 'Plain', createdAt: 'x', workplaceType: 'ONSITE', city: { cityName: 'Wien', countryName: 'Austria' } },
      { id: 3, idParam: '3-hourly', title: 'Hourly', salaryFrequency: 'PER_HOUR', salaryAmountFrom: { amount: 2500, currency: 'EUR' } },
      { id: 4, idParam: '4-lowonly', title: 'Low only', salaryFrequency: 'PER_YEAR', salaryAmountFrom: { amount: 5000000, currency: 'EUR' }, salaryAmountTo: null },
      { id: 5, idParam: '../../evil', title: 'Bad idParam' },
      { id: 6, idParam: '6-notitle', title: '  ' },
    ],
    pagination: { rowCount: 7, pageCount: 2, page: 1, pageSize: 5 },
  };
  const jobs = mod.parseJoinPage(page1, 'justhiringde', 'Just Hiring');
  ok(jobs.length === 4, `parseJoinPage keeps 4 valid rows (got ${jobs.length})`);
  ok(jobs[0].url === 'https://join.com/companies/justhiringde/16797130-online-marketing-manager-m-w-d-im-homeoffice', 'url from domain + idParam');
  ok(jobs[0].location === 'Berlin, Germany, Remote', `location + Remote (got ${jobs[0].location})`);
  ok(jobs[0].postedAt === Date.parse('2026-10-07T10:51:51.523Z'), 'postedAt from createdAt');
  ok(JSON.stringify(jobs[0].salary) === JSON.stringify({ min: 60000, max: 100000, currency: 'EUR' }), `PER_YEAR minor units -> annual major units (got ${JSON.stringify(jobs[0].salary)})`);
  ok(!('salary' in jobs[1]) && !('postedAt' in jobs[1]), 'no salary / unparseable date omitted');
  ok(!('salary' in jobs[2]), 'PER_HOUR salary omitted (period not annualizable)');
  ok(jobs[3].salary && jobs[3].salary.min === 50000 && jobs[3].salary.max === null, 'one-sided range keeps unknown bound null (never 0)');
  ok(!jobs.some(j => j.url.includes('evil')), 'malformed idParam dropped');
  ok(mod.parseJoinPage({}, 'd', 'C').length === 0 && mod.parseJoinPage(null, 'd', 'C').length === 0, 'malformed payload -> []');

  // fetch: company page + 2 list pages
  const calls = [];
  const sleeps = [];
  const ctx = {
    sleep: async ms => { sleeps.push(ms); },
    fetchText: async (url, opts) => { calls.push({ url, opts }); return pageHtml.replace('Just \\"Hiring\\"', 'JH'); },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      return url.includes('page=1') ? page1 : { items: [{ id: 9, idParam: '9-last', title: 'Last' }], pagination: { pageCount: 2, page: 2 } };
    },
  };
  const entry = { name: 'Just Hiring', careers_url: 'https://join.com/companies/justhiringde' };
  const all = await p.fetch(entry, ctx);
  ok(calls[0].url === 'https://join.com/companies/justhiringde', 'fetch first resolves the company page');
  ok(calls[1].url === 'https://join.com/api/public/companies/167291/jobs?page=1&pageSize=5' && calls[2].url.includes('page=2'), 'fetch walks list pages with pageSize=5');
  ok(calls.length === 3, `fetch stops at pagination.pageCount (calls=${calls.length})`);
  ok(calls.every(c => c.opts?.redirect === 'error'), "every request passes redirect:'error'");
  ok(all.length === 5 && all.every(j => j.company === 'Just Hiring'), 'fetch returns 5 jobs with entry.name as company');
  ok(sleeps.length === 1, 'paces between list pages');

  calls.length = 0;
  const capped = await p.fetch(entry, { ...ctx, maxPages: 1 });
  ok(calls.length === 2 && capped.length === 4, 'ctx.maxPages=1 stops after first list page (control: 2 pages above)');

  // company page whose domain differs -> refuse; hostile careers_url -> no request
  let t1 = false;
  try { await p.fetch({ name: 'X', careers_url: 'https://join.com/companies/otherco' }, ctx); } catch { t1 = true; }
  ok(t1, 'fetch refuses when the page names a different company domain');
  calls.length = 0;
  let t2 = false;
  try { await p.fetch({ name: 'X', careers_url: 'https://evil.example/companies/justhiringde' }, ctx); } catch { t2 = true; }
  ok(t2 && calls.length === 0, 'fetch rejects hostile careers_url without any request');
} catch (e) {
  fail(`join provider tests crashed: ${e.message}`);
}
