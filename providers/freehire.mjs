// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { intInRange } from './_config-utils.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

// freehire.me provider — hits the public, unauthenticated agent search API
// (https://freehire.me/api/v1/agent/jobs/search) behind the freehire.me
// aggregator. Verified live 2026-09-01: GET returns 200 with no key,
// `meta.total: 3199525` across the raw catalogue; countries=dk&is_tech=tech
// alone returns 2337 — a real, usable Danish tech-market slice with zero
// Danish-specific code (docs/AI-JOB-SEARCH-PORT-PLAN.md Phase 7). One
// board-wide provider covers ~120 source ATS platforms normalized into one
// schema, across every market Jobber has a mode for and every one it doesn't.
//
// WHY /agent/jobs/search, not /jobs/search (docs/FREEHIRE-INTEGRATION-PLAN.md
// F1): the two take the same query and filters, but /jobs/search returns the
// search index's truncated description preview (~1,000 chars — verified live
// 2026-10-21: 967-992 chars vs 1,655-3,479 for the same postings), while the
// agent route returns the description in full. scan.mjs feeds `description`
// to content_filter, country_eligibility_filter, the visa filter and the JD
// SimHash fingerprint, so a truncated body silently weakens all four.
// `description_format=text` asks for tags stripped — what those regex
// filters and the fingerprint want.
//
// Configure via a `job_boards` (or `tracked_companies`) entry with
// `provider: freehire` and an optional `freehire:` block:
//
//   - name: freehire — Platform Engineering (EU)
//     provider: freehire
//     freehire:
//       keywords: ["Platform Engineer", "SRE"]  # optional — falls back to
//         # config/profile.yml target_roles when omitted
//       countries: ["dk", "de"]       # optional ISO 3166-1 alpha-2 codes
//       regions: ["eu"]               # optional macro-region codes
//       sources: ["ukg", "paycom"]    # optional — only these source platforms
//       exclude_sources: ["greenhouse"]  # optional — skip platforms scanned natively
//       remote: true                  # optional — alias for work_mode: [remote]
//       work_mode: ["remote", "hybrid"]
//       seniority: ["senior", "lead"]
//       category: ["backend", "devops"]
//       employment_type: ["full_time"]
//       is_tech: "tech"               # "tech" | "non_tech" | omit for both
//       visa_sponsorship: true        # true / false; omit for either
//       requires_clearance: false     # false drops clearance-only roles
//       exclude_company_types: ["outstaff", "agency"]
//       exclude_reality: ["likely-evergreen"]
//       open_within_days: 14          # first seen by freehire in the last N days
//       posted_within_days: 14        # source-stated posting date (see below)
//       salary_min: 90000             # needs salary_currency, else ignored
//       salary_currency: "EUR"        # USD | EUR | GBP | RUB
//       page_size: 50                 # results per keyword page (1–100; default 50)
//     enabled: true
//
// open_within_days vs posted_within_days: posted_within_days trusts the date
// the SOURCE states, and some boards restate it on every crawl, so a
// months-old posting can pass a narrow bound. open_within_days counts from
// when freehire first recorded the posting and cannot be rewritten from
// outside — prefer it for freshness.
//
// PROVENANCE: the query vocabulary comes from the backend's own source and
// generated API reference (github.com/strelov1/freehire — MIT,
// self-hostable: docs/API.md §Filtering jobs), read directly rather than
// guessed. Every enumerated facet below is validated against that
// vocabulary; an unrecognized value is DROPPED here rather than sent, because
// freehire ignores unknown values silently and a dropped filter is
// indistinguishable from a broad result. Open vocabularies (countries,
// regions) pass through lowercased — call GET /jobs/facets for live values.
//
// SALARY: emitted only when the posting states a currency (3-letter code)
// AND a year or month period — annual figures pass as-is, monthly ones are
// multiplied by 12. day/hour periods stay omitted: annualizing them needs a
// full-time-hours assumption this provider cannot verify per posting, and a
// wrong guess silently drops a well-paid role as "below minimum" (see the Job
// contract's KEY PRESENCE note in _types.js).
//
// POSTING HISTORY: freehire ships a deterministic `reality` block on every
// posting (first-seen age, repost count, concurrent-posting count, a
// "posting date restated" flag). Mapped to the generic Job.postingHistory
// value object as facts only — freehire's own class label
// (fresh/stale/likely-evergreen) is deliberately NOT carried, so downstream
// consumers can report evidence but never a verdict.
//
// Self-hosting: FREEHIRE_API_URL points this at a self-hosted instance.
// Validated as http(s) before use and never followed through a redirect
// (redirect:'error') — an unvalidated base-URL override is an SSRF
// primitive handed to anything that can set the environment.

const DEFAULT_BASE_URL = 'https://freehire.me';
const SEARCH_PATH = '/api/v1/agent/jobs/search';
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 3;
// Every request after the first pays it (same idiom as eures.mjs/tencent.mjs).
const INTER_PAGE_DELAY_MS = 150;
// A 429 whose Retry-After fits under this is waited out once per page; a
// longer one ends that keyword (the scan must not stall on one provider).
const MAX_RETRY_AFTER_MS = 30_000;

// Vocabularies from freehire docs/API.md §Facets (2026-10-21).
const SENIORITY = ['intern', 'junior', 'middle', 'senior', 'lead', 'staff', 'principal', 'c_level'];
const CATEGORY = [
  'software_engineering', 'backend', 'frontend', 'fullstack', 'mobile', 'devops', 'sre',
  'network_engineering', 'data_engineering', 'data_science', 'data_analytics', 'ml_ai',
  'ai_engineering', 'qa', 'security', 'hardware', 'embedded', 'blockchain', 'architecture',
  'design', 'creative', 'engineering_design', 'industrial_engineering', 'occupational_safety',
  'product', 'project_management', 'healthcare', 'skilled_trades', 'retail', 'hospitality',
  'logistics', 'education', 'personal_services', 'administration', 'social_services',
  'science', 'manufacturing', 'public_safety', 'marketing', 'sales', 'support',
  'business_analysis', 'solutions_engineering', 'developer_relations', 'technical_writing',
  'recruiting', 'hr', 'finance', 'legal', 'operations', 'customer_success', 'other',
];
const EMPLOYMENT_TYPE = ['full_time', 'part_time', 'contract', 'internship', 'fellowship'];
const WORK_MODE = ['remote', 'hybrid', 'onsite'];
const COMPANY_TYPE = ['product', 'startup', 'outsource', 'outstaff', 'agency', 'inhouse', 'government'];
const REALITY = ['fresh', 'stale', 'likely-evergreen'];
const SALARY_CURRENCY = ['USD', 'EUR', 'GBP', 'RUB'];

/**
 * Declarative facet table — one row per supported `freehire:` config key.
 * `kind` selects the sanitizer; `allowed` (when present) is a closed
 * vocabulary and anything outside it is dropped. Adding a facet is one row.
 * @type {ReadonlyArray<{key: string, param: string, kind: 'list'|'enum'|'bool'|'int', allowed?: string[], upper?: boolean}>}
 */
export const FACETS = Object.freeze([
  { key: 'countries', param: 'countries', kind: 'list' },
  { key: 'regions', param: 'regions', kind: 'list' },
  // Open vocabulary (freehire's ~320 source keys, docs/sources.md): restrict a
  // search to platforms (`ukg`, `paycom`, …) or drop ones a native provider
  // already scans. Verified live 2026-10-21: repeated values OR together.
  { key: 'sources', param: 'source', kind: 'list' },
  { key: 'exclude_sources', param: 'source_exclude', kind: 'list' },
  { key: 'work_mode', param: 'work_mode', kind: 'list', allowed: WORK_MODE },
  { key: 'seniority', param: 'seniority', kind: 'list', allowed: SENIORITY },
  { key: 'category', param: 'category', kind: 'list', allowed: CATEGORY },
  { key: 'employment_type', param: 'employment_type', kind: 'list', allowed: EMPLOYMENT_TYPE },
  { key: 'exclude_company_types', param: 'company_type_exclude', kind: 'list', allowed: COMPANY_TYPE },
  { key: 'exclude_reality', param: 'reality_exclude', kind: 'list', allowed: REALITY },
  { key: 'is_tech', param: 'is_tech', kind: 'enum', allowed: ['tech', 'non_tech'] },
  { key: 'visa_sponsorship', param: 'visa_sponsorship', kind: 'bool' },
  { key: 'requires_clearance', param: 'requires_clearance', kind: 'bool' },
  { key: 'open_within_days', param: 'open_within_days', kind: 'int' },
  { key: 'posted_within_days', param: 'posted_within_days', kind: 'int' },
  { key: 'salary_min', param: 'salary_min', kind: 'int' },
  { key: 'salary_currency', param: 'salary_currency', kind: 'enum', allowed: SALARY_CURRENCY, upper: true },
]);

/**
 * Sanitize one raw config value per its facet row. Returns null for "not
 * set / invalid" so the caller can drop it uniformly.
 * @param {typeof FACETS[number]} facet
 * @param {unknown} raw
 * @returns {string[] | string | boolean | number | null}
 */
function sanitizeFacet(facet, raw) {
  /** @param {string} v */
  const norm = (v) => (facet.upper ? v.trim().toUpperCase() : v.trim().toLowerCase());
  /** @param {string} v */
  const inVocab = (v) => !facet.allowed || facet.allowed.includes(v);
  switch (facet.kind) {
    case 'list': {
      const values = (Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []))
        .filter((v) => typeof v === 'string' && v.trim())
        .map(norm)
        .filter(inVocab);
      const unique = [...new Set(values)];
      return unique.length ? unique : null;
    }
    case 'enum': {
      if (typeof raw !== 'string') return null;
      const v = norm(raw);
      return inVocab(v) ? v : null;
    }
    case 'bool':
      return typeof raw === 'boolean' ? raw : null;
    case 'int':
      return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null;
    default:
      return null;
  }
}

/**
 * Resolve and validate the API base URL. Falls back to the default on any
 * invalid override (unparseable, or a scheme other than http/https) rather
 * than throwing — a misconfigured env var should degrade to the known-good
 * default, not break scanning.
 * @returns {string}
 */
export function resolveBaseUrl() {
  const raw = process.env.FREEHIRE_API_URL;
  if (!raw) return DEFAULT_BASE_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return DEFAULT_BASE_URL;
    return raw.replace(/\/+$/, '');
  } catch {
    return DEFAULT_BASE_URL;
  }
}

/**
 * Reads and sanitizes the entry's `freehire:` config block.
 *
 * `filters` is the ordered list of `[param, value]` pairs every request
 * carries; the named fields (countries, regions, remote, isTech,
 * postedWithinDays) are kept for callers and tests that read them directly.
 * @param {{ freehire?: any }} entry
 * @returns {{ keywords: string[], countries: string[], regions: string[], remote: boolean, isTech: string|null, postedWithinDays: number|null, pageSize: number, filters: Array<[string, string]> }}
 */
export function parseFreehireConfig(entry) {
  const cfg = (entry && entry.freehire) || {};
  /** @type {Record<string, any>} */
  const values = {};
  for (const facet of FACETS) {
    const v = sanitizeFacet(facet, cfg[facet.key]);
    if (v !== null) values[facet.key] = v;
  }

  // `remote: true` is the original shorthand — fold it into work_mode.
  const remote = cfg.remote === true;
  if (remote) values.work_mode = [...new Set([...(values.work_mode || []), 'remote'])];

  // A salary floor without a currency would compare across currencies on
  // the server — meaningless, so it is dropped rather than sent.
  if (values.salary_min !== undefined && values.salary_currency === undefined) delete values.salary_min;

  /** @type {Array<[string, string]>} */
  const filters = [];
  for (const facet of FACETS) {
    const v = values[facet.key];
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) filters.push([facet.param, item]);
    else filters.push([facet.param, String(v)]);
  }

  return {
    keywords: [...new Set(
      (Array.isArray(cfg.keywords) ? cfg.keywords : [])
        .filter((k) => typeof k === 'string' && k.trim())
        .map((k) => k.trim()),
    )],
    countries: values.countries || [],
    regions: values.regions || [],
    remote,
    isTech: values.is_tech ?? null,
    postedWithinDays: values.posted_within_days ?? null,
    pageSize: intInRange(cfg.page_size, DEFAULT_PAGE_SIZE, 1, 100),
    filters,
  };
}

/**
 * Build the query string for one keyword page.
 * @param {{ keyword: string, pageSize: number, page: number, filters: Array<[string, string]> }} args
 * @returns {URLSearchParams}
 */
export function buildSearchParams({ keyword, pageSize, page, filters }) {
  const params = new URLSearchParams();
  params.set('q', keyword);
  params.set('limit', String(pageSize));
  params.set('offset', String(page * pageSize));
  params.set('description_format', 'text');
  for (const [param, value] of filters) params.append(param, value);
  return params;
}

/** @type {Readonly<Record<string, number>>} */
const PERIOD_MULTIPLIERS = Object.freeze({ year: 1, month: 12 });

/**
 * Annualize freehire's enrichment salary, or return null when the posting
 * does not state it precisely enough (no currency, no bound, or a day/hour
 * period). KEY PRESENCE: when non-null, all three keys are present and an
 * unknown bound is null — never 0.
 * @param {any} enrichment
 * @returns {{min: number|null, max: number|null, currency: string} | null}
 */
export function annualizeSalary(enrichment) {
  if (!enrichment || typeof enrichment !== 'object') return null;
  const currency = typeof enrichment.salary_currency === 'string' ? enrichment.salary_currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const multiplier = Object.hasOwn(PERIOD_MULTIPLIERS, enrichment.salary_period) ? PERIOD_MULTIPLIERS[enrichment.salary_period] : 0;
  if (!multiplier) return null;
  /** @param {unknown} v */
  const bound = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * multiplier) : null);
  let min = bound(enrichment.salary_min);
  let max = bound(enrichment.salary_max);
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return { min, max, currency };
}

/**
 * Map freehire's `reality` block to the generic Job.postingHistory facts.
 * Returns null when the block is absent or carries no usable age.
 * @param {any} reality
 * @returns {{source: string, ageDays: number, repostCount: number|null, concurrentCount: number|null, fakeFreshness: boolean} | null}
 */
export function postingHistoryFrom(reality) {
  if (!reality || typeof reality !== 'object') return null;
  /** @param {unknown} v */
  const count = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  const ageDays = count(reality.age_days);
  if (ageDays === null) return null;
  return {
    source: 'freehire',
    ageDays,
    repostCount: count(reality.repost_count),
    concurrentCount: count(reality.mass_posting_count),
    fakeFreshness: reality.fake_freshness === true,
  };
}

/**
 * Normalizes one raw `data[]` record into a Job — the anti-corruption layer:
 * freehire's wire vocabulary stops here. Returns null when the posting lacks
 * a usable title or URL.
 * @param {any} job
 * @returns {(import('./_types.js').Job) | null}
 */
export function normalizeJob(job) {
  const title = String((job && job.title) || '').trim();
  const url = String((job && job.url) || '').trim();
  if (!title || !/^https?:\/\//i.test(url)) return null;

  /** @type {import('./_types.js').Job} */
  const out = {
    title,
    url,
    company: String((job && job.company) || '').trim(),
    location: String((job && job.location) || '').trim(),
  };

  const description = String((job && job.description) || '').trim(); // full text on the agent route
  if (description) out.description = description;

  const posted = Date.parse((job && job.posted_at) || '');
  if (Number.isFinite(posted) && posted > 0) out.postedAt = posted;

  const salary = annualizeSalary(job && job.enrichment);
  if (salary) out.salary = salary;

  const history = postingHistoryFrom(job && job.reality);
  if (history) out.postingHistory = history;

  const slug = typeof job?.public_slug === 'string' ? job.public_slug.trim() : '';
  if (/^[a-z0-9][a-z0-9-]*$/i.test(slug)) out.externalRef = { source: 'freehire', id: slug };

  return out;
}

/**
 * Milliseconds to wait for a Retry-After header value (delta-seconds or an
 * HTTP-date), or null when absent/unparseable.
 * @param {unknown} value
 * @param {number} [now]
 * @returns {number|null}
 */
export function retryAfterMs(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** @type {Provider} */
export default {
  id: 'freehire',

  detect(entry) {
    return entry?.provider === 'freehire' ? { url: `${resolveBaseUrl()}${SEARCH_PATH}` } : null;
  },

  /**
   * Fetches and normalizes postings from the freehire.me public agent search API.
   * @param {{ name?: string, freehire?: any }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, maxPages?: number, sleep?: (ms: number) => Promise<void> }} ctx
   * @returns {Promise<import('./_types.js').Job[]>}
   */
  async fetch(entry, ctx) {
    const { keywords: ownKeywords, pageSize, filters } = parseFreehireConfig(entry);
    let keywords = ownKeywords;
    if (!keywords.length) keywords = resolveProfileKeywords();
    if (!keywords.length) {
      throw new Error(`freehire: entry "${entry.name || '(unnamed)'}" has no freehire.keywords[] and no config/profile.yml target_roles to fall back to`);
    }

    const baseUrl = resolveBaseUrl();
    const maxPages = Math.min(DEFAULT_MAX_PAGES, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
    /** @param {number} ms */
    const sleep = (ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    /** @type {Map<string, import('./_types.js').Job>} */
    const seen = new Map();
    const errors = [];
    let succeeded = 0;
    let firstRequest = true;

    for (const keyword of keywords) {
      let keywordSucceeded = false;
      for (let page = 0; page < maxPages; page++) {
        if (firstRequest) firstRequest = false;
        else await sleep(INTER_PAGE_DELAY_MS);

        const url = `${baseUrl}${SEARCH_PATH}?${buildSearchParams({ keyword, pageSize, page, filters }).toString()}`;
        // redirect:'error' prevents SSRF via a server-side redirect — load-
        // bearing here because baseUrl can come from FREEHIRE_API_URL.
        const request = () => ctx.fetchJson(url, { redirect: 'error', timeoutMs: 15_000 });

        let json;
        try {
          try {
            json = await request();
          } catch (err) {
            const wait = err && err.status === 429 ? retryAfterMs(err.retryAfter) : null;
            if (wait === null || wait > MAX_RETRY_AFTER_MS) throw err;
            await sleep(wait);
            json = await request(); // one retry per page; a second failure ends the keyword
          }
        } catch (err) {
          errors.push(`"${keyword}": ${(err && err.message) || err}`);
          break; // try the next keyword; keep whatever this one already yielded
        }
        keywordSucceeded = true;

        const rows = Array.isArray(json && json.data) ? json.data : [];
        if (rows.length === 0) break;

        for (const row of rows) {
          const job = normalizeJob(row);
          if (job && !seen.has(job.url)) seen.set(job.url, job);
        }

        if (rows.length < pageSize) break; // short page → done with this keyword
      }
      if (keywordSucceeded) succeeded++;
    }

    // Total outage = every keyword's first request failed. A keyword that
    // answered with zero results is not an outage.
    if (succeeded === 0 && errors.length) {
      throw new Error(`freehire: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...seen.values()];
  },
};
