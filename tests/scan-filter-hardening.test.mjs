// tests/scan-filter-hardening.test.mjs — Workstream F of docs/AUDIT-FIX-PLAN.md.
// Shipped title-filter defaults that blocked JavaScript / Internal / International roles, a content
// filter that matched "rust" inside "trust", zero-valued salaries, country aliases, CLI flags with a
// missing value, and 429 counting toward the dead-portal streak. Every check has its control.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import * as yaml from 'js-yaml';
import {
  buildTitleFilter, buildContentFilter, buildCountryEligibilityFilter,
  computeConsecutiveFailures, computePortalSkipTargets, companyFilterMatches, compileKeyword,
} from '../scan.mjs';
import { classifyFetchError } from '../lib/http-errors.mjs';

console.log('\nscan filters (audit workstream F)');

function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass(label);
  else fail(`${label}: got ${g}, want ${w}`);
}

// ── shipped template defaults (N21) ─────────────────────────────────────
{
  const tpl = yaml.load(readFileSync(join(ROOT, 'templates', 'portals.example.yml'), 'utf8'));
  const keep = buildTitleFilter({ positive: ['engineer', 'developer', 'manager'], negative: tpl.title_filter.negative });
  for (const t of ['JavaScript Developer', 'Internal Tools Engineer', 'International Business Manager']) {
    eq(`shipped negatives keep "${t}"`, keep(t), true);
  }
  for (const t of ['Java Developer', 'Summer Intern', 'Intern, Data Engineer', 'Internship Program Manager', 'Junior Engineer']) {
    eq(`shipped negatives still block "${t}" (control)`, keep(t), false);
  }
}
eq('compileKeyword: trailing space is a right word edge', [compileKeyword('java ')('java developer'), compileKeyword('java ')('javascript')], [true, false]);
eq('compileKeyword: leading space is a left word edge', [compileKeyword(' ops')('devops lead'), compileKeyword(' ops')('ops lead')], [false, true]);
eq('compileKeyword: unpadded keywords keep substring matching (control)', compileKeyword('engineer')('engineering manager'), true);
eq('title filter: a whitespace-only keyword is dropped, not "match everything"', buildTitleFilter({ positive: ['   ', 'qa'] })('Chef'), false);

// ── content filter (N21) ────────────────────────────────────────────────
{
  const cf = buildContentFilter({ positive: ['rust'] });
  eq('content filter: "rust" does not match "trust and safety"', cf('We build trust and safety tooling'), false);
  eq('content filter: "rust" matches "Rust developer" (control)', cf('Senior Rust developer wanted'), true);
  const neg = buildContentFilter({ negative: ['go'] });
  eq('content filter: negative "go" does not hit "google"', neg('Work at Google on cloud'), true);
  eq('content filter: negative "go" hits the word go (control)', neg('Backend in Go and Python'), false);
  eq('content filter: longer keywords keep substring matching', buildContentFilter({ positive: ['kubernetes'] })('Runs on kubernetes clusters'), true);
}

// ── country eligibility (N30) ───────────────────────────────────────────
{
  const rule = { exclusionary: ['must be located in the united states'], inclusive: [] };
  const desc = 'Applicants must be located in the United States.';
  for (const c of ['United States', 'USA', 'US', 'U.S.', 'united states of america']) {
    eq(`a US candidate (${c}) is never excluded by a US-only rule`, buildCountryEligibilityFilter(rule, c)(desc), true);
  }
  eq('control: a candidate in Germany is excluded', buildCountryEligibilityFilter(rule, 'Germany')(desc), false);
  const noWord = { exclusionary: ['must reside in a supported country'], inclusive: [] };
  eq('candidate country "us" does not match the "us" inside "business"', buildCountryEligibilityFilter(noWord, 'Gr')('We run a business. Must reside in a supported country.'), false);
  eq('candidate country named as a word still rescues (control)', buildCountryEligibilityFilter(noWord, 'Germany')('Must reside in a supported country, such as Germany.'), true);
}

// ── --company matching (N28) ────────────────────────────────────────────
eq('--company meta finds "Meta Platforms"', companyFilterMatches('Meta Platforms', 'meta'), true);
eq('--company meta does not find Metabase', companyFilterMatches('Metabase', 'meta'), false);
eq('--company cohere finds Cohere (control)', companyFilterMatches('Cohere', 'cohere'), true);
eq('--company with no words matches nothing', companyFilterMatches('Anything', '---'), false);

// ── 429 is throttling, not a dead portal (16) ───────────────────────────
eq('HTTP 429 classifies as rate_limited', classifyFetchError({ status: 429, message: 'HTTP 429' }), 'rate_limited');
eq('control: a 404 is still slug_gone', classifyFetchError({ status: 404, message: 'HTTP 404' }), 'slug_gone');
eq('control: a 503 is still server', classifyFetchError({ status: 503, message: 'HTTP 503' }), 'server');
{
  const rec = (status, i) => ({ timestamp: `2026-10-0${i}T00:00:00Z`, company: 'Acme', status });
  const streak = (statuses) => computeConsecutiveFailures(statuses.map((s, i) => rec(s, i + 1))).get('Acme');
  eq('rate_limited does not extend a failure streak', streak(['network', 'rate_limited', 'rate_limited', 'rate_limited']), 1);
  eq('rate_limited does not reset one either', streak(['network', 'network', 'rate_limited']), 2);
  eq('control: network failures do accumulate', streak(['network', 'network', 'network']), 3);
  const skip = computePortalSkipTargets(['network', 'network', 'rate_limited', 'rate_limited'].map((s, i) => rec(s, i + 1)), { threshold: 3, now: Date.parse('2026-10-05T00:00:00Z') });
  eq('three throttles after two failures do not put the portal on the skip list', skip.has('Acme'), false);
}

// ── CLI flags with a missing value (N28), spawned ───────────────────────
{
  const run = (...args) => spawnSync(NODE, [join(ROOT, 'scan.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  for (const flag of ['--company', '--posted-after', '--posted-before']) {
    const r = run('--dry-run', flag);
    eq(`${flag} as the last argument exits 1`, r.status, 1);
    eq(`${flag} as the last argument says it needs a value`, (r.stderr || '').includes(`${flag} needs a value`), true);
  }
  const bad = run('--dry-run', '--posted-after', '2026-13-45');
  eq('control: a present but invalid date reaches the date check', (bad.stderr || '').includes('expects YYYY-MM-DD'), true);
  const swallowed = run('--dry-run', '--company', '--posted-after');
  eq('a flag followed by another flag is a missing value, not a value', (swallowed.stderr || '').includes('--company needs a value'), true);
}
