// tests/providers/isolvedhire.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — isolvedhire');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

const PAGE = `<html><script>window.bootstrapVue("#job_listings",['JobListings'],{ componentData: { organizationId : 6149, domainId : 8214, getParams : {} }});</script></html>`;

// Shape of the live https://saratech.isolvedhire.com/core/jobs/8214 payload (2026-10-21), trimmed.
const mk = (over) => ({
  id: 1598610, title: 'CAD Application Engineer', city: 'Cincinnati', iso3: 'USA', abbreviation: 'OH',
  startDateRef: 'Sep 19, 2025', workplaceType: 'Fully remote', employmentType: 'Full Time',
  payTypeFrame: 'per year', minSalary: '90,000', maxSalary: '130,000',
  jobLocation: 'Cincinnati, OH 45201, USA', jobUrl: 'https://acme.isolvedhire.com/jobs/1598610', ...over,
});
const PAYLOAD = {
  success: true,
  data: {
    jobCount: 9,
    jobs: [
      mk({}),
      mk({ id: 2, title: 'Hourly Co-op', payTypeFrame: 'per hour', minSalary: '20', maxSalary: '30', workplaceType: 'On site', jobUrl: 'https://evil.example/jobs/2' }),
      mk({ id: 3, title: 'Daily Pay', payTypeFrame: 'per day', minSalary: '200', maxSalary: '300' }),
      mk({ id: 4, title: 'Min Only', payTypeFrame: 'per year', minSalary: '52,000', maxSalary: '' }),
      mk({ id: 5, title: 'No Pay', payTypeFrame: null, minSalary: '', maxSalary: '', iso3: 'CAN', startDateRef: '' }),
      mk({ id: 1598610, title: 'Dup Id' }),
      mk({ id: 'x1', title: 'Bad Id' }),
      mk({ id: 7, title: '  ' }),
      mk({ id: 8, title: 'City Fallback', jobLocation: '', city: 'Irvine', abbreviation: 'CA', workplaceType: 'Work from home flexibility' }),
    ],
  },
};

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/isolvedhire.mjs')).href);
  const iso = mod.default;
  const { parseIsolvedResponse, extractDomainId, parseSalary } = mod;

  check(iso.id === 'isolvedhire', 'isolvedhire.id is "isolvedhire"');

  const hit = iso.detect({ name: 'A', careers_url: 'https://acme.isolvedhire.com/jobs/' });
  check(hit?.url === 'https://acme.isolvedhire.com/jobs/', `isolvedhire.detect() accepts <tenant>.isolvedhire.com (got ${JSON.stringify(hit)})`);
  check(iso.detect({ name: 'A', careers_url: 'https://acme.isolvedhire.com/jobs/1598610' })?.url === 'https://acme.isolvedhire.com/jobs/', 'isolvedhire.detect() accepts a job URL and returns the tenant listing');
  check(iso.detect({ name: 'A', careers_url: 'https://example.com/jobs/' }) === null, 'isolvedhire.detect() null for non-iSolved host');
  check(iso.detect({ name: 'A', careers_url: 'http://acme.isolvedhire.com/jobs/' }) === null, 'isolvedhire.detect() null for http scheme');
  check(iso.detect({ name: 'A', careers_url: 'https://evil-isolvedhire.com/jobs/' }) === null, 'isolvedhire.detect() null for lookalike host evil-isolvedhire.com');
  check(iso.detect({ name: 'A', careers_url: 'https://acme.isolvedhire.com.evil.example/jobs/' }) === null, 'isolvedhire.detect() null for suffix-spoofed host');
  check(iso.detect({ name: 'A', careers_url: 'https://evil.example/acme.isolvedhire.com/jobs/' }) === null, 'isolvedhire.detect() null for path-spoofed URL');
  check(iso.detect({ name: 'A', careers_url: undefined }) === null, 'isolvedhire.detect() null for missing careers_url');

  check(extractDomainId(PAGE) === '8214', 'extractDomainId reads domainId from the /jobs/ page');
  check(extractDomainId('<html>nothing</html>') === null && extractDomainId(null) === null, 'extractDomainId null when absent / non-string');

  // salary annualization (control cases alongside the rejects)
  check(JSON.stringify(parseSalary(mk({}))) === '{"min":90000,"max":130000,"currency":"USD"}', 'parseSalary per year passes through');
  check(JSON.stringify(parseSalary(mk({ payTypeFrame: 'per hour', minSalary: '20', maxSalary: '30' }))) === '{"min":41600,"max":62400,"currency":"USD"}', 'parseSalary per hour × 2080');
  check(JSON.stringify(parseSalary(mk({ payTypeFrame: 'per month', minSalary: '5,000.50', maxSalary: '' }))) === '{"min":60006,"max":null,"currency":"USD"}', 'parseSalary per month × 12, unknown bound is null (never 0)');
  check(parseSalary(mk({ payTypeFrame: 'per day' })) === null, 'parseSalary omits an unrecognised pay frame');
  check(parseSalary(mk({ minSalary: '', maxSalary: '' })) === null, 'parseSalary omits when both amounts are blank');
  check(parseSalary(mk({ iso3: 'CAN' }))?.currency === '', 'parseSalary currency is "" when iso3 is not USA');

  const jobs = parseIsolvedResponse(PAYLOAD, 'https://acme.isolvedhire.com', 'Acme');
  const titles = jobs.map((j) => j.title);
  check(JSON.stringify(titles) === JSON.stringify(['CAD Application Engineer', 'Hourly Co-op', 'Daily Pay', 'Min Only', 'No Pay', 'City Fallback']),
    `parseIsolvedResponse drops dup id, non-numeric id, blank title (got ${JSON.stringify(titles)})`);
  check(jobs[0].url === 'https://acme.isolvedhire.com/jobs/1598610' && jobs[0].company === 'Acme' && jobs[0].postedAt === Date.UTC(2025, 8, 19),
    `parseIsolvedResponse url/company/postedAt (got ${JSON.stringify(jobs[0])})`);
  check(jobs[0].location === 'Cincinnati, OH 45201, USA (Remote)' && jobs[1].location === 'Cincinnati, OH 45201, USA', 'parseIsolvedResponse location from jobLocation, "(Remote)" only for workplaceType Fully remote');
  check(jobs[1].url === 'https://acme.isolvedhire.com/jobs/2', 'parseIsolvedResponse replaces an off-host jobUrl with <origin>/jobs/<id>');
  check(jobs[1].salary?.min === 41600 && jobs[1].salary?.max === 62400, 'parseIsolvedResponse annualizes hourly salary');
  check(!('salary' in jobs[2]), 'parseIsolvedResponse omits salary for an unknown pay frame');
  check(jobs[3].salary && jobs[3].salary.min === 52000 && jobs[3].salary.max === null && 'currency' in jobs[3].salary, 'parseIsolvedResponse one-sided salary keeps all three keys with null (not 0)');
  check(!('postedAt' in jobs[4]) && !('salary' in jobs[4]), 'parseIsolvedResponse omits postedAt/salary when blank');
  check(jobs[5].location === 'Irvine, CA', 'parseIsolvedResponse falls back to city + state abbreviation');
  check(jobs[0].location.length > 0 && !/remote/i.test(jobs[1].location), 'parseIsolvedResponse does not tag non-remote jobs Remote');
  check(parseIsolvedResponse(mkRemote(), 'https://acme.isolvedhire.com', 'A')[0].location === 'Remote', 'parseIsolvedResponse "Fully remote" with no location → Remote');
  check(parseIsolvedResponse({}, 'https://a.isolvedhire.com', 'A').length === 0 && parseIsolvedResponse({ data: { jobs: null } }, 'https://a.isolvedhire.com', 'A').length === 0, 'parseIsolvedResponse malformed payload → []');

  // fetch with mock ctx: two requests, redirect:'error' on both, domainId carried into the API URL
  const calls = [];
  const ctx = {
    fetchText: async (url, opts) => { calls.push({ kind: 'text', url, opts }); return PAGE; },
    fetchJson: async (url, opts) => { calls.push({ kind: 'json', url, opts }); return PAYLOAD; },
  };
  const fetched = await iso.fetch({ name: 'Acme', careers_url: 'https://acme.isolvedhire.com/jobs/' }, ctx);
  check(calls.length === 2 && calls[0].url === 'https://acme.isolvedhire.com/jobs/' && calls[1].url === 'https://acme.isolvedhire.com/core/jobs/8214?getParams=%7B%7D'
    && calls.every((c) => c.opts?.redirect === 'error'), `isolvedhire.fetch() GETs /jobs/ then /core/jobs/<domainId> with redirect:'error' (got ${JSON.stringify(calls)})`);
  check(fetched.length === 6, 'isolvedhire.fetch() returns parsed jobs');

  // missing domainId → clear error, no JSON request
  let jsonCalled = false;
  let msg = '';
  try {
    await iso.fetch({ name: 'Acme', careers_url: 'https://acme.isolvedhire.com/jobs/' }, { fetchText: async () => '<html></html>', fetchJson: async () => { jsonCalled = true; return PAYLOAD; } });
  } catch (e) { msg = e.message; }
  check(/domainId/.test(msg) && !jsonCalled, `isolvedhire.fetch() throws a domainId error and makes no API call when the page lacks it (got ${JSON.stringify(msg)})`);

  const hostile = [];
  let threw = false;
  try {
    await iso.fetch({ name: 'X', careers_url: 'https://evil.example/jobs/' }, { fetchText: async (u) => { hostile.push(u); return PAGE; }, fetchJson: async (u) => { hostile.push(u); return PAYLOAD; } });
  } catch { threw = true; }
  check(threw && hostile.length === 0, 'isolvedhire.fetch() rejects a hostile careers_url without making a request');
} catch (e) {
  fail(`isolvedhire provider tests crashed: ${e.message}`);
}

function mkRemote() {
  return { data: { jobs: [mk({ id: 9, jobLocation: '', city: '', abbreviation: '', workplaceType: 'Fully remote' })] } };
}
