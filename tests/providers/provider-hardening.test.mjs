// tests/providers/provider-hardening.test.mjs — Workstream H of docs/AUDIT-FIX-PLAN.md.
// Ashby salary read from a REAL captured payload, hackernews URLs that need &#x2F; decoding, a null
// element in a board payload, and the csod / softgarden request hardening. Each has its control.
import { pass, fail, ROOT } from '../helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider hardening (audit workstream H)');

const load = async (name) => import(pathToFileURL(join(ROOT, 'providers', `${name}.mjs`)).href);
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass(label);
  else fail(`${label}: got ${g}, want ${w}`);
}

// ── Ashby: salary from the live summaryComponents shape (finding 7) ─────
{
  const { default: ashby, parseCompensation } = await load('ashby');
  // Trimmed capture of https://api.ashbyhq.com/posting-api/job-board/ashby?includeCompensation=true (2026-10-22)
  const fixture = JSON.parse(readFileSync(join(ROOT, 'tests', 'providers', 'fixtures', 'ashby-compensation.json'), 'utf8'));
  eq('live payload: EUR salary range is read from the Salary component', parseCompensation(fixture.jobs[0]), { min: 110000, max: 185000, currency: 'EUR' });
  eq('live payload: USD salary range', parseCompensation(fixture.jobs[1]), { min: 180000, max: 260000, currency: 'USD' });
  eq('live payload: bonus / equity components are never mistaken for salary', parseCompensation({ compensation: { summaryComponents: [{ compensationType: 'Bonus', interval: '1 YEAR', currencyCode: 'USD', minValue: 5000, maxValue: 9000 }] } }), null);
  eq('control: the old flat shape still parses', parseCompensation({ compensation: { minValue: 100, maxValue: 200, interval: '1 YEAR', currency: 'usd' } }), { min: 100, max: 200, currency: 'USD' });
  eq('a monthly salary component is annualised', parseCompensation({ compensation: { summaryComponents: [{ compensationType: 'Salary', interval: '1 MONTH', currencyCode: 'EUR', minValue: 5000, maxValue: 6000 }] } })?.min, 60000);

  const jobs = await ashby.fetch(
    { name: 'Ashby', careers_url: 'https://jobs.ashbyhq.com/ashby' },
    { fetchJson: async () => ({ jobs: [null, { title: 'Eng', jobUrl: 'https://jobs.ashbyhq.com/ashby/1', location: 'Remote', compensation: fixture.jobs[0].compensation }] }) },
  );
  eq('end to end: a null element is skipped and the salary survives', jobs.map((j) => [j.title, j.salary?.min, j.salary?.currency]), [['Eng', 110000, 'EUR']]);
}

// ── hackernews: links HN encodes as &#x2F; (N1) ─────────────────────────
{
  const { parseHnComment } = await load('hackernews');
  const thread = 'https://news.ycombinator.com/item?id=1';
  const a = parseHnComment('Acme | Engineer | Remote | <a href="https:&#x2F;&#x2F;acme.com&#x2F;jobs&#x2F;1" rel="nofollow">https:&#x2F;&#x2F;acme.com&#x2F;jobs&#x2F;1</a>', thread);
  const b = parseHnComment('Beta | Designer | NYC | <a href="https:&#x2F;&#x2F;beta.io&#x2F;careers" rel="nofollow">https:&#x2F;&#x2F;beta.io&#x2F;careers</a>', thread);
  eq('hackernews: the posting URL is decoded, not the thread fallback', [a?.url, b?.url], ['https://acme.com/jobs/1', 'https://beta.io/careers']);
  eq('hackernews: two different postings no longer share one URL', a?.url !== b?.url, true);
  eq('control: a comment with no link still falls back to the thread', parseHnComment('Gamma | Dev | Remote', thread)?.url, thread);
}

// ── null elements in a board payload must not crash the board (N5) ──────
{
  const lever = (await load('lever')).default;
  const lj = await lever.fetch({ name: 'Acme', careers_url: 'https://jobs.lever.co/acme' }, { fetchJson: async () => [null, { text: 'Eng', hostedUrl: 'https://jobs.lever.co/acme/1' }] });
  eq('lever: [null, job] yields the job', lj.map((j) => j.title), ['Eng']);

  const gh = (await load('greenhouse')).default;
  const gj = await gh.fetch({ name: 'Acme', api: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs' }, { fetchJson: async () => ({ jobs: [null, { title: 'Eng', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', location: { name: 'Berlin' } }] }) });
  eq('greenhouse: {jobs:[null, job]} yields the job', gj.map((j) => j.title), ['Eng']);

  const { parseRecruiteeResponse } = await load('recruitee');
  eq('recruitee: offers [null, offer] yields the offer', parseRecruiteeResponse({ offers: [null, { title: 'Eng', careers_url: 'https://acme.recruitee.com/o/eng' }] }, 'Acme').map((j) => j.title), ['Eng']);

  const { parseSmartRecruitersResponse } = await load('smartrecruiters');
  eq('smartrecruiters: content [null, posting] yields the posting', parseSmartRecruitersResponse({ content: [null, { name: 'Eng', ref: 'https://api.smartrecruiters.com/v1/companies/acme/postings/1', id: '1' }] }, 'Acme').map((j) => j.title), ['Eng']);

  const amazon = (await load('amazon')).default;
  const aj = await amazon.fetch({ name: 'Amazon', careers_url: 'https://www.amazon.jobs/en/search' }, { fetchJson: async () => ({ jobs: [null, { title: 'SDE', job_path: '/en/jobs/1' }] }) });
  eq('amazon: jobs [null, job] yields the job', aj.map((j) => j.title), ['SDE']);
}

// ── csod / softgarden request hardening (17, N3) ────────────────────────
{
  const { resolveConfig } = await load('csod');
  eq('csod: an http careersite URL is refused (the bearer token would travel in clear)', resolveConfig({ api: 'http://acme.csod.com/ux/ats/careersite/4/home?c=acme' }), null);
  eq('csod: control - the https careersite URL resolves', resolveConfig({ api: 'https://acme.csod.com/ux/ats/careersite/4/home?c=acme' })?.siteId, 4);

  const seen = [];
  const { default: csod } = await load('csod');
  await csod.fetch({ name: 'Acme', api: 'https://acme.csod.com/ux/ats/careersite/4/home?c=acme' }, { fetchText: async (u, o) => { seen.push(o); return ''; }, fetchJson: async () => ({}) }).catch(() => {});
  eq('csod: the home page request refuses redirects', seen[0]?.redirect, 'error');

  const sg = (await load('softgarden')).default;
  const seenSg = [];
  await sg.fetch({ name: 'Acme', careers_url: 'https://acme.softgarden.io/de/widgets/jobs' }, { fetchText: async (u, o) => { seenSg.push(o); return ''; }, fetchJson: async () => ({}) }).catch(() => {});
  eq('softgarden: the widget request refuses redirects', seenSg[0]?.redirect, 'error');
}
