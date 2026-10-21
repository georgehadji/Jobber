#!/usr/bin/env node
/**
 * freehire-cli.mjs — explicit, read-only freehire.me lookups
 * (docs/FREEHIRE-INTEGRATION-PLAN.md Phase 6).
 *
 * The network step that zero-network scripts deliberately leave to the user:
 * salary-import.mjs, company-intel.mjs and prepare-application.mjs never
 * fetch. This CLI fetches from the public, keyless freehire API and PRINTS —
 * it never writes a file. The user saves the output and feeds it to the
 * zero-network script themselves, so each script's boundary stays intact.
 *
 * Commands (dispatch table below; each is a pure formatter over one GET):
 *   salary      Market salary band → JSON in salary-import.mjs's input shape
 *               (advertised/source: benchmark — the bottom trust tier; and
 *               salary-gap.mjs reports it in its own benchmark series).
 *   apply-form  The ATS application form freehire captured for a posting →
 *               Markdown questions for prepare-application / application-answers.
 *               Read-only context: nothing is filled in or submitted.
 *   company     Company facts → Markdown the user MAY paste into
 *               data/company-intel/{slug}.md (company-intel.mjs reads it as
 *               untrusted pasted intel, never as verified fact).
 *
 * Network: providers/_http.mjs fetchJson with redirect:'error'; base URL from
 * providers/freehire.mjs resolveBaseUrl (FREEHIRE_API_URL, validated http/s).
 * Path segments are validated as plain slugs before they reach a URL.
 *
 * Run: node freehire-cli.mjs salary --category backend --seniority senior --country DE --num 042
 *      node freehire-cli.mjs apply-form <slug> | --url <posting url from scan-history>
 *      node freehire-cli.mjs company <slug>
 *      node freehire-cli.mjs --capabilities
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { fetchJson as httpFetchJson } from './providers/_http.mjs';
import { resolveBaseUrl } from './providers/freehire.mjs';

const JOBBER = dirname(fileURLToPath(import.meta.url));
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;
const COUNTRY_RE = /^[a-z]{2}$/i;
const VOCAB_RE = /^[a-z][a-z_-]*$/;

const USAGE = `Usage:
  node freehire-cli.mjs salary --category <c> [--seniority <s>] [--country <CC>] (--num <tracker#> | --company <name>) [--role <role>]
  node freehire-cli.mjs apply-form <slug> | --url <posting url>
  node freehire-cli.mjs company <slug>
  node freehire-cli.mjs --capabilities`;

// --- Argument parsing (pure) ---
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${a} expects a value`);
      options[a.slice(2)] = value;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { command, options, positional };
}

// --- Formatters (pure) ---

/**
 * freehire /insights/salary rows → salary-import.mjs input records.
 * Only yearly and monthly (×12) bands are emitted; anything else is dropped
 * rather than annualized by guesswork (same rule as providers/freehire.mjs).
 */
export function toSalaryImportRecords(rows, { num, company, role, category, seniority, country, date }) {
  const multiplier = { year: 1, month: 12 };
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const m = Object.hasOwn(multiplier, r?.period) ? multiplier[r.period] : 0;
    const p25 = Number(r?.p25), p75 = Number(r?.p75);
    const currency = typeof r?.currency === 'string' ? r.currency.trim().toUpperCase() : '';
    if (!m || !(p25 > 0) || !(p75 > 0) || !/^[A-Z]{3}$/.test(currency)) continue;
    const scope = [category, r.seniority || seniority, country].filter(Boolean).join('/');
    const record = {
      amount: `${Math.round(p25 * m)}-${Math.round(p75 * m)}`,
      currency,
      note: `freehire insights ${scope} p25-p75, n=${Number.isFinite(r.sample_size) ? r.sample_size : '?'}`,
    };
    if (num !== undefined) record.num = Number(num);
    if (company) record.company = company;
    if (role) record.role = role;
    if (date) record.date = date;
    out.push(record);
  }
  return out;
}

export function formatApplyForm(slug, form) {
  const lines = [`## Application form — freehire capture (${form?.provider || 'unknown ATS'})`, '', `Posting: \`${slug}\``, ''];
  const basics = Array.isArray(form?.basics) ? form.basics.filter(b => typeof b === 'string') : [];
  if (basics.length) lines.push(`Standard fields: ${basics.join(', ')}`, '');
  const questions = Array.isArray(form?.questions) ? form.questions.filter(q => q && typeof q.text === 'string') : [];
  if (questions.length) {
    lines.push('Questions:');
    questions.forEach((q, i) => lines.push(`${i + 1}. ${q.text.replace(/\s+/g, ' ').trim()}${q.required ? ' *(required)*' : ''}`));
  } else {
    lines.push('No custom questions captured.');
  }
  lines.push('', '_Captured by freehire.me; the live form may differ — check it before answering. Nothing was filled in or submitted._');
  return lines.join('\n');
}

export function formatCompany(company) {
  const c = company || {};
  const list = (v) => (Array.isArray(v) && v.length ? v.join(', ') : null);
  const facts = [
    ['Name', c.name],
    ['Tagline', c.tagline],
    ['HQ country', c.hq_country],
    ['Founded', c.year_founded],
    ['Employees (reported)', c.employee_count],
    ['Size bucket', list(c.company_sizes)],
    ['Organization type', c.organization_type],
    ['Company types seen in postings', list(c.company_types)],
    ['Industries', list(c.industries)],
    ['Hiring regions', list(c.regions)],
    ['Open postings on freehire', c.job_count],
    ['YC batch', list(c.yc_batch)],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  return [
    `## Company facts — freehire.me (${c.slug || 'unknown'})`,
    '',
    ...facts.map(([k, v]) => `- ${k}: ${String(v).replace(/\s+/g, ' ').trim()}`),
    '',
    '_Aggregated by freehire.me from job postings and public directories; unverified. Paste into data/company-intel/ only if you want it as research context._',
  ].join('\n');
}

/**
 * Find a posting's external reference in scan-history (col 12, `source:id`).
 * shortcut: exact match on the stored (normalized) URL in col 0; paste the URL
 * as it appears in pipeline.md/scan-history. Upgrade by exporting scan.mjs's
 * normalizeScanUrl if lookups by raw URLs become common.
 */
export function findFreehireSlug(scanHistory, url) {
  const target = String(url || '').trim();
  let slug = null;
  for (const line of String(scanHistory || '').split('\n')) {
    const cols = line.split('\t');
    if (cols[0]?.trim() !== target) continue;
    const ref = (cols[12] || '').trim();
    if (ref.startsWith('freehire:')) slug = ref.slice('freehire:'.length); // later rows win
  }
  return slug && SLUG_RE.test(slug) ? slug : null;
}

// --- Commands (dispatch table) ---
const COMMANDS = {
  async salary({ options }, { fetchJson, baseUrl }) {
    const { category, seniority, country, num, company, role } = options;
    if (!category || !VOCAB_RE.test(category)) throw new Error('--category is required (a freehire category, e.g. backend)');
    if (seniority && !VOCAB_RE.test(seniority)) throw new Error('--seniority must be a freehire seniority value, e.g. senior');
    if (country && !COUNTRY_RE.test(country)) throw new Error('--country must be an ISO 3166-1 alpha-2 code, e.g. DE');
    if (num === undefined && !company) throw new Error('--num <tracker#> or --company <name> is required (salary-import.mjs needs one to attach the benchmark)');
    if (num !== undefined && !/^\d+$/.test(num)) throw new Error('--num must be a tracker number');
    const params = new URLSearchParams({ category });
    if (seniority) params.set('seniority', seniority);
    if (country) params.set('country', country.toLowerCase());
    const json = await fetchJson(`${baseUrl}/api/v1/insights/salary?${params}`, { redirect: 'error', timeoutMs: 15_000 });
    const records = toSalaryImportRecords(json?.data, {
      num, company, role, category, seniority, country: country?.toUpperCase(), // date omitted: salary-import.mjs defaults it to today
    });
    if (!records.length) return { stderr: 'freehire: no yearly/monthly salary band for that scope (nothing to import)', code: 2 };
    return { stdout: JSON.stringify(records, null, 2) };
  },

  async 'apply-form'({ options, positional }, { fetchJson, baseUrl, rootDir }) {
    let slug = positional[0];
    if (!slug && options.url) {
      const path = join(rootDir, 'data/scan-history.tsv');
      slug = existsSync(path) ? findFreehireSlug(readFileSync(path, 'utf-8'), options.url) : null;
      if (!slug) return { stderr: 'freehire: that URL has no freehire reference in data/scan-history.tsv', code: 2 };
    }
    if (!slug || !SLUG_RE.test(slug)) throw new Error('apply-form needs a freehire posting slug or --url');
    try {
      const json = await fetchJson(`${baseUrl}/api/v1/jobs/${slug}/apply-form`, { redirect: 'error', timeoutMs: 15_000 });
      return { stdout: formatApplyForm(slug, json?.data) };
    } catch (err) {
      if (err?.status === 404) return { stderr: `freehire: no captured application form for ${slug}`, code: 2 };
      throw err;
    }
  },

  async company({ positional }, { fetchJson, baseUrl }) {
    const slug = positional[0];
    if (!slug || !SLUG_RE.test(slug)) throw new Error('company needs a freehire company slug');
    try {
      const json = await fetchJson(`${baseUrl}/api/v1/companies/${slug}?limit=1`, { redirect: 'error', timeoutMs: 15_000 });
      return { stdout: formatCompany(json?.data?.company) };
    } catch (err) {
      if (err?.status === 404) return { stderr: `freehire: no company ${slug}`, code: 2 };
      throw err;
    }
  },
};

/**
 * Run one command. Injectable fetch for tests; returns {stdout?, stderr?, code}.
 */
export async function run(argv, { fetchJson = httpFetchJson, baseUrl = resolveBaseUrl(), rootDir = JOBBER } = {}) {
  if (argv.includes('--capabilities')) {
    return {
      stdout: JSON.stringify({
        script: 'freehire-cli.mjs', version: 1,
        flags: ['--category', '--seniority', '--country', '--num', '--company', '--role', '--url', '--capabilities', '--help'],
        description: 'Read-only freehire.me lookups: salary benchmark, captured apply form, company facts',
      }),
      code: 0,
    };
  }
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) return { stdout: USAGE, code: argv.length ? 0 : 1 };
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    return { stderr: `${err.message}\n${USAGE}`, code: 1 };
  }
  const command = Object.hasOwn(COMMANDS, parsed.command) ? COMMANDS[parsed.command] : null;
  if (!command) return { stderr: `unknown command "${parsed.command}"\n${USAGE}`, code: 1 };
  try {
    const result = await command(parsed, { fetchJson, baseUrl, rootDir });
    return { code: 0, ...result };
  } catch (err) {
    return { stderr: `freehire: ${err?.message || err}`, code: 1 };
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await run(process.argv.slice(2));
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(result.code);
}
