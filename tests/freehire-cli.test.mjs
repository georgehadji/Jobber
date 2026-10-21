// tests/freehire-cli.test.mjs — freehire-cli.mjs (docs/FREEHIRE-INTEGRATION-PLAN.md Phase 6):
// read-only lookups, injected fetch, no file writes.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nfreehire-cli — salary / apply-form / company');

try {
  const { run, toSalaryImportRecords, formatApplyForm, formatCompany, findFreehireSlug } = await import(pathToFileURL(join(ROOT, 'freehire-cli.mjs')).href);
  const { parseAmount } = await import(pathToFileURL(join(ROOT, 'salary-gap.mjs')).href);
  const base = 'https://freehire.test';

  // salary → salary-import shape; live response shape (2026-10-21)
  const rows = [
    { seniority: 'senior', currency: 'EUR', period: 'year', sample_size: 13, p25: 77500, p50: 97500, p75: 125000 },
    { seniority: 'senior', currency: 'eur', period: 'month', sample_size: 4, p25: 5000, p75: 7000 },
    { seniority: 'senior', currency: 'EUR', period: 'hour', sample_size: 9, p25: 50, p75: 80 },
    { seniority: 'senior', currency: '', period: 'year', sample_size: 2, p25: 1, p75: 2 },
  ];
  const recs = toSalaryImportRecords(rows, { num: '42', category: 'backend', country: 'DE', date: '2026-10-21' });
  if (recs.length === 2 && recs[0].amount === '77500-125000' && recs[0].currency === 'EUR' && recs[0].num === 42
      && recs[1].amount === '60000-84000' && recs[1].currency === 'EUR') {
    pass('toSalaryImportRecords emits yearly bands as-is, monthly ×12, and drops hourly / currency-less bands');
  } else fail(`salary records = ${JSON.stringify(recs)}`);
  if (recs.every((r) => parseAmount(r.amount) !== null) && /n=13/.test(recs[0].note)) {
    pass('salary amounts parse with salary-gap.mjs parseAmount and the note carries the sample size');
  } else fail('salary records must be salary-import/salary-gap compatible');

  let seenUrl = null;
  const ok = await run(['salary', '--category', 'backend', '--seniority', 'senior', '--country', 'DE', '--num', '42'], {
    baseUrl: base, fetchJson: async (url, opts) => { seenUrl = url; if (opts.redirect !== 'error') throw new Error('redirect not pinned'); return { data: rows.slice(0, 1) }; },
  });
  if (ok.code === 0 && JSON.parse(ok.stdout)[0].amount === '77500-125000'
      && seenUrl === `${base}/api/v1/insights/salary?category=backend&seniority=senior&country=de`) {
    pass('salary command queries /insights/salary with redirect:error and prints import JSON');
  } else fail(`salary run = ${JSON.stringify(ok)} url=${seenUrl}`);

  const noTarget = await run(['salary', '--category', 'backend'], { baseUrl: base, fetchJson: async () => ({ data: rows }) });
  const badCountry = await run(['salary', '--category', 'backend', '--country', 'Germany', '--num', '1'], { baseUrl: base, fetchJson: async () => ({ data: rows }) });
  if (noTarget.code === 1 && badCountry.code === 1) pass('salary refuses a missing --num/--company and a non-ISO country');
  else fail(`salary validation codes ${noTarget.code}/${badCountry.code}`);
  const empty = await run(['salary', '--category', 'backend', '--company', 'Acme'], { baseUrl: base, fetchJson: async () => ({ data: [] }) });
  if (empty.code === 2 && !empty.stdout) pass('salary with no usable band prints nothing to import (exit 2)');
  else fail(`empty salary = ${JSON.stringify(empty)}`);

  // apply-form
  const md = formatApplyForm('sre-acme-1', { provider: 'greenhouse', basics: ['resume', 'linkedin'], questions: [{ text: 'Why  us?\n', required: true }, { text: 'Notice period' }] });
  if (/greenhouse/.test(md) && /1\. Why us\? \*\(required\)\*/.test(md) && /2\. Notice period$/m.test(md) && /Nothing was filled in or submitted/.test(md)) {
    pass('formatApplyForm lists standard fields and numbered questions, marking required ones');
  } else fail(`apply-form markdown = ${md}`);
  const notFound = await run(['apply-form', 'sre-acme-1'], { baseUrl: base, fetchJson: async () => { const e = new Error('HTTP 404'); e.status = 404; throw e; } });
  if (notFound.code === 2 && /no captured application form/.test(notFound.stderr)) pass('apply-form maps a 404 to "no captured form" (exit 2)');
  else fail(`apply-form 404 = ${JSON.stringify(notFound)}`);
  let fetched = false;
  const traversal = await run(['apply-form', '../../admin'], { baseUrl: base, fetchJson: async () => { fetched = true; return {}; } });
  if (traversal.code === 1 && !fetched) pass('apply-form rejects a non-slug before any request');
  else fail('apply-form must validate the slug before fetching');

  // --url lookup through scan-history col 12
  const tsv = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company\texternal_ref',
    ['https://jobs.example/1', '2026-10-01', 'freehire', 'SRE', 'Acme', 'added', '', '', '', '', '', 'acme', 'freehire:sre-acme-1'].join('\t'),
  ].join('\n');
  if (findFreehireSlug(tsv, 'https://jobs.example/1') === 'sre-acme-1' && findFreehireSlug(tsv, 'https://jobs.example/2') === null) {
    pass('findFreehireSlug resolves a scan-history URL to its freehire slug');
  } else fail('findFreehireSlug lookup');
  const tmp = mkdtempSync(join(tmpdir(), 'jobber-freehire-cli-'));
  mkdirSync(join(tmp, 'data'));
  writeFileSync(join(tmp, 'data', 'scan-history.tsv'), tsv);
  let formUrl = null;
  const byUrl = await run(['apply-form', '--url', 'https://jobs.example/1'], {
    baseUrl: base, rootDir: tmp, fetchJson: async (url) => { formUrl = url; return { data: { provider: 'lever', questions: [] } }; },
  });
  if (byUrl.code === 0 && formUrl === `${base}/api/v1/jobs/sre-acme-1/apply-form`) pass('apply-form --url reads the slug from data/scan-history.tsv');
  else fail(`apply-form --url = ${JSON.stringify(byUrl)} url=${formUrl}`);

  // company
  const cmd = formatCompany({ slug: 'acme', name: 'Acme', hq_country: 'DE', year_founded: 2015, company_sizes: ['51-200'], tagline: '' });
  if (/- Name: Acme/.test(cmd) && /- Founded: 2015/.test(cmd) && !/Tagline/.test(cmd) && /unverified/.test(cmd)) {
    pass('formatCompany prints present facts only and marks them unverified');
  } else fail(`company markdown = ${cmd}`);

  // dispatch
  const unknown = await run(['delete-everything'], { baseUrl: base, fetchJson: async () => ({}) });
  const proto = await run(['toString'], { baseUrl: base, fetchJson: async () => ({}) });
  const caps = await run(['--capabilities']);
  if (unknown.code === 1 && proto.code === 1 && JSON.parse(caps.stdout).script === 'freehire-cli.mjs') {
    pass('unknown and prototype-key commands are refused; --capabilities reports the flag list');
  } else fail('dispatch table guards');
} catch (e) {
  fail(`freehire-cli tests crashed: ${e.message}`);
}
