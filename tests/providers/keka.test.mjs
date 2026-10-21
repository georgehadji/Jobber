// tests/providers/keka.test.mjs — fixture shaped like live minfy.keka.com /careers/api/jobs/default/active (2026-10-21).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — keka');
const ok = (c, m) => (c ? pass(m) : fail(m));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/keka.mjs')).href);
  const p = mod.default;
  ok(p.id === 'keka', 'keka.id is "keka"');

  const hit = p.detect({ name: 'Minfy', careers_url: 'https://minfy.keka.com/careers/' });
  ok(hit?.url === 'https://minfy.keka.com/careers/api/jobs/default/active', 'detect() tenant careers URL -> active API');
  ok(p.detect({ name: 'M', careers_url: 'https://minfy.keka.com/careers/jobdetails/164456' })?.url?.startsWith('https://minfy.keka.com/'), 'detect() accepts job-detail URL');
  ok(p.detect({ name: 'M', careers_url: 'http://minfy.keka.com/careers' }) === null, 'detect() rejects http');
  ok(p.detect({ name: 'M', careers_url: 'https://evil-keka.com/careers' }) === null, 'detect() rejects lookalike evil-keka.com');
  ok(p.detect({ name: 'M', careers_url: 'https://minfy.keka.com.evil.example/careers' }) === null, 'detect() rejects suffix-spoofed host');
  ok(p.detect({ name: 'M', careers_url: 'https://evil.example/minfy.keka.com/careers' }) === null, 'detect() rejects path-spoofed URL');
  ok(p.detect({ name: 'M', careers_url: 'https://www.keka.com/careers' }) === null, 'detect() rejects vendor www.keka.com');
  ok(p.detect({ name: 'M', careers_url: 7 }) === null, 'detect() null for non-string careers_url');

  const sample = [
    {
      id: 164456, title: 'Technical Account Manager',
      description: '<div><strong>Role</strong></div><div>P&amp;L owner</div>',
      jobLocations: [{ city: 'Hyderabad', state: 'TG', countryCode: 'IN', countryName: 'India' }],
      jobType: 2, publishedOn: '2026-10-07T09:24:36.45Z',
      salaryRange: { minimum: 1, maximum: 3000000, currency: 'INR', salaryPeriod: 0 },
    },
    { id: 2, title: 'Intern', description: '', jobLocations: [], jobType: 3, publishedOn: 'garbage' },
    { id: 0, title: 'zero id' },
    { id: 5, title: '  ' },
    { title: 'no id' },
    null,
  ];
  const jobs = mod.parseKekaJobs(sample, 'https://acme.keka.com/careers', 'Acme');
  ok(jobs.length === 2, `parseKekaJobs keeps 2 valid rows (got ${jobs.length})`);
  ok(jobs[0].url === 'https://acme.keka.com/careers/jobdetails/164456' && jobs[0].company === 'Acme', 'url + company built');
  ok(jobs[0].location === 'Hyderabad, TG, India', 'location joined city/state/country');
  ok(jobs[0].description === 'Role\nP&L owner', `description stripped (got ${JSON.stringify(jobs[0].description)})`);
  ok(jobs[0].postedAt === Date.parse('2026-10-07T09:24:36.45Z'), 'postedAt from publishedOn (epoch ms)');
  ok(!('salary' in jobs[0]), 'placeholder salaryRange is NOT surfaced');
  ok(jobs[1].location === '' && !('postedAt' in jobs[1]) && !('description' in jobs[1]), 'unparseable date / empty description omitted');
  ok(!jobs.some(j => j.title === 'zero id' || j.title === 'no id'), 'rows with no valid id dropped');
  ok(mod.parseKekaJobs({}, 'b', 'c').length === 0 && mod.parseKekaJobs(null, 'b', 'c').length === 0, 'non-array payload -> []');

  const calls = [];
  const ctx = { fetchJson: async (url, opts) => { calls.push({ url, opts }); return sample; } };
  const fetched = await p.fetch({ name: 'Acme', careers_url: 'https://acme.keka.com/careers' }, ctx);
  ok(calls.length === 1 && calls[0].url === 'https://acme.keka.com/careers/api/jobs/default/active', 'fetch hits the tenant active API once');
  ok(calls[0].opts?.redirect === 'error', "fetch passes redirect:'error'");
  ok(fetched.length === 2, 'fetch returns parsed jobs');

  let threw = false;
  try { await p.fetch({ name: 'E', careers_url: 'https://evil.example/careers' }, ctx); } catch { threw = true; }
  ok(threw && calls.length === 1, 'fetch rejects hostile careers_url without any request');
} catch (e) {
  fail(`keka provider tests crashed: ${e.message}`);
}
