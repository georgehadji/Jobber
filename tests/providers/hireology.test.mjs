// tests/providers/hireology.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — hireology');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

// Shape of the live https://api.hireology.com/v1/careers/visitingangels payload
// (2026-10-21), trimmed, plus rows the parser must drop.
const PAYLOAD = {
  data: [
    {
      type: 'careers', id: '2485834',
      attributes: {
        id: 2485834, name: 'Home Health Aide - with sign on bonus', remote: false,
        'job-description': '<p>Visiting Angels&nbsp;of West Chester &amp; more.</p><ul><li>Valid license</li></ul><script>x()</script>',
        locations: ['West Chester, OH'], status: 'Open',
        'career-site-url': 'https://careers.hireology.com/visitingangels-westchester/2485834/description',
        'job-family': { id: 12, name: 'Healthcare / Medical' }, 'employment-status': 'Part Time - hourly',
      },
    },
    { type: 'careers', id: '77', attributes: { name: 'Remote Coordinator', remote: true, locations: [], status: 'OPEN', 'career-site-url': 'https://evil.example/x' } },
    { type: 'careers', id: '999', attributes: { name: 'Closed Role', status: 'Filled', locations: [] } },
    { type: 'careers', id: '', attributes: { name: 'No Id', status: 'Open' } },
    { type: 'careers', id: '5', attributes: { name: '  ', status: 'Open' } },
  ],
};

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/hireology.mjs')).href);
  const hireology = mod.default;
  const { parseHireologyResponse } = mod;

  check(hireology.id === 'hireology', 'hireology.id is "hireology"');

  const hit = hireology.detect({ name: 'VA', careers_url: 'https://careers.hireology.com/visitingangels' });
  check(hit?.url === 'https://api.hireology.com/v1/careers/visitingangels', `hireology.detect() → api.hireology.com/v1/careers/<slug> (got ${JSON.stringify(hit)})`);
  check(hireology.detect({ name: 'VA', careers_url: 'https://careers.hireology.com/visitingangels-westchester/2485834/description' })?.url === 'https://api.hireology.com/v1/careers/visitingangels-westchester', 'hireology.detect() takes the slug from a job-page URL');
  check(hireology.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null, 'hireology.detect() null for non-Hireology host');
  check(hireology.detect({ name: 'X', careers_url: 'http://careers.hireology.com/acme' }) === null, 'hireology.detect() null for http scheme');
  check(hireology.detect({ name: 'X', careers_url: 'https://evil-careers.hireology.com/acme' }) === null, 'hireology.detect() null for lookalike host evil-careers.hireology.com');
  check(hireology.detect({ name: 'X', careers_url: 'https://careers.hireology.com.evil.example/acme' }) === null, 'hireology.detect() null for suffix-spoofed host');
  check(hireology.detect({ name: 'X', careers_url: 'https://evil.example/careers.hireology.com/acme' }) === null, 'hireology.detect() null for path-spoofed URL');
  check(hireology.detect({ name: 'X', careers_url: 'https://careers.hireology.com/' }) === null, 'hireology.detect() null when there is no slug');
  check(hireology.detect({ name: 'X', careers_url: 'https://careers.hireology.com/a%2Fb' }) === null, 'hireology.detect() null for a slug with encoded slash');
  check(hireology.detect({ name: 'X', careers_url: null }) === null, 'hireology.detect() null for non-string careers_url');

  const jobs = parseHireologyResponse(PAYLOAD, 'visitingangels', 'Visiting Angels');
  check(jobs.length === 2, `parseHireologyResponse keeps only Open rows with id+name (got ${jobs.length})`);
  check(!jobs.some((j) => j.title === 'Closed Role'), 'parseHireologyResponse drops non-Open (Filled) rows');
  check(jobs[0]?.url === 'https://careers.hireology.com/visitingangels-westchester/2485834/description' && jobs[0]?.location === 'West Chester, OH' && jobs[0]?.company === 'Visiting Angels',
    `parseHireologyResponse row 0 url/location/company (got ${JSON.stringify({ ...jobs[0], description: undefined })})`);
  check(jobs[0]?.description === 'Visiting Angels of West Chester & more.\nValid license', `parseHireologyResponse strips HTML/script from description (got ${JSON.stringify(jobs[0]?.description)})`);
  check(jobs[1]?.url === 'https://careers.hireology.com/visitingangels/77/description', 'parseHireologyResponse ignores an off-host career-site-url and builds the canonical URL');
  check(jobs[1]?.location === 'Remote' && !('description' in jobs[1]), 'parseHireologyResponse adds Remote for remote:true and omits an absent description');
  check(!('postedAt' in jobs[0]) && !('salary' in jobs[0]), 'parseHireologyResponse omits postedAt/salary (API has neither)');
  check(parseHireologyResponse({}, 's', 'A').length === 0 && parseHireologyResponse({ data: null }, 's', 'A').length === 0, 'parseHireologyResponse malformed payload → []');

  const calls = [];
  const jobsF = await hireology.fetch(
    { name: 'VA', careers_url: 'https://careers.hireology.com/visitingangels' },
    { fetchJson: async (url, opts) => { calls.push({ url, opts }); return PAYLOAD; } },
  );
  check(calls.length === 1 && calls[0].url === 'https://api.hireology.com/v1/careers/visitingangels' && calls[0].opts?.redirect === 'error', `hireology.fetch() single GET with redirect:'error' (got ${JSON.stringify(calls)})`);
  check(jobsF.length === 2 && jobsF[0].company === 'VA', 'hireology.fetch() returns parsed jobs with entry.name as company');

  const hostile = [];
  let threw = false;
  try {
    await hireology.fetch({ name: 'X', careers_url: 'https://evil.example/acme' }, { fetchJson: async (u) => { hostile.push(u); return PAYLOAD; } });
  } catch { threw = true; }
  check(threw && hostile.length === 0, 'hireology.fetch() rejects a hostile careers_url without making a request');
} catch (e) {
  fail(`hireology provider tests crashed: ${e.message}`);
}
