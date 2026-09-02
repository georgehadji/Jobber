// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { intInRange } from './_config-utils.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

// freehire.me provider — hits the public, unauthenticated job-search API
// (https://freehire.me/api/v1/jobs/search) behind the freehire.me aggregator.
// Verified live 2026-09-01: GET returns 200 with no key, `meta.total: 3199525`
// across the raw catalogue; countries=dk&is_tech=tech alone returns 2337 —
// a real, usable Danish tech-market slice with zero Danish-specific code
// (docs/AI-JOB-SEARCH-PORT-PLAN.md Phase 7). One board-wide provider covers
// ~50 source ATS platforms normalized into one schema, across every market
// Jobber has a mode for and every one it doesn't.
//
// Configure via a `job_boards` (or `tracked_companies`) entry with
// `provider: freehire` and an optional `freehire:` block:
//
//   - name: freehire — Platform Engineering (EU)
//     provider: freehire
//     freehire:
//       keywords: ["Platform Engineer", "SRE"]  # optional — falls back to
//         # config/profile.yml target_roles when omitted
//       countries: ["dk", "de"]   # optional ISO 3166-1 alpha-2 codes
//       regions: ["eu"]           # optional macro-region codes (see PROVENANCE)
//       remote: true              # optional — filters work_mode=remote
//       is_tech: "tech"           # optional — "tech" (default) | "non_tech" | omit for both
//       posted_within_days: 14    # optional freshness cutoff
//       page_size: 50             # results per keyword page (1–100; default 50)
//     enabled: true
//
// PROVENANCE: the query vocabulary (facet param names, StringFacets map,
// rate-limit shape) comes from the backend's own source
// (github.com/strelov1/freehire — MIT, self-hostable), read directly rather
// than guessed: internal/search/search/query_filter.go's `StringFacets` map
// and internal/api/handler/search.go's `searchParams`. The published
// openapi.yaml (https://freehire.me/openapi.yaml) corroborates it. `regions`
// values are a noisy mix of real macro-regions (eu, apac, latam, mena, cis,
// global) and leaked raw country codes (us, uk, de) — call GET /jobs/facets
// to see live values before relying on a specific one; an unrecognized value
// is not an error, it just matches nothing (openapi.yaml's own documented
// behavior).
//
// SALARY OMITTED BY DESIGN: enrichment.salary_min/max carry no normalized
// currency or period — `salary_period` is one of year|month|day|hour per
// entry, uncorrelated across postings, and day/hour → annual needs a
// full-time-hours assumption this provider cannot verify per posting.
// Guessing wrong silently drops a well-paid role as "below minimum" with no
// visible error (see the Job contract's KEY PRESENCE note in _types.js) —
// the same reasoning eures.mjs omits salary for. Omitted entirely rather
// than risk it.
//
// Self-hosting: the skill env var this was ported from, FREEHIRE_API_URL,
// is honored here too. Validated as http(s) before use and never followed
// through a redirect (redirect:'error') — an unvalidated base-URL override
// is an SSRF primitive handed to anything that can set the environment.

const DEFAULT_BASE_URL = 'https://freehire.me';
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 3;
// Every request after the first pays it (same idiom as eures.mjs/tencent.mjs).
const INTER_PAGE_DELAY_MS = 150;

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
 * @param {{ freehire?: any }} entry
 * @returns {{ keywords: string[], countries: string[], regions: string[], remote: boolean, isTech: string|null, postedWithinDays: number|null, pageSize: number }}
 */
export function parseFreehireConfig(entry) {
  const cfg = (entry && entry.freehire) || {};
  const cleanList = (value) => [...new Set(
    (Array.isArray(value) ? value : [])
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => v.trim().toLowerCase()),
  )];
  const ALLOWED_IS_TECH = new Set(['tech', 'non_tech']);
  return {
    keywords: [...new Set(
      (Array.isArray(cfg.keywords) ? cfg.keywords : [])
        .filter((k) => typeof k === 'string' && k.trim())
        .map((k) => k.trim()),
    )],
    countries: cleanList(cfg.countries),
    regions: cleanList(cfg.regions),
    remote: cfg.remote === true,
    isTech: ALLOWED_IS_TECH.has(cfg.is_tech) ? cfg.is_tech : null,
    postedWithinDays: Number.isInteger(cfg.posted_within_days) && cfg.posted_within_days > 0 ? cfg.posted_within_days : null,
    pageSize: intInRange(cfg.page_size, DEFAULT_PAGE_SIZE, 1, 100),
  };
}

/**
 * Normalizes one raw `data[]` record into a Job. Returns null when the
 * posting lacks a usable title or URL.
 * @param {any} job
 * @returns {({title: string, url: string, company: string, location: string, description?: string, postedAt?: number}) | null}
 */
export function normalizeJob(job) {
  const title = String((job && job.title) || '').trim();
  const url = String((job && job.url) || '').trim();
  if (!title || !/^https?:\/\//i.test(url)) return null;

  const out = {
    title,
    url,
    company: String((job && job.company) || '').trim(),
    location: String((job && job.location) || '').trim(),
  };

  const description = String((job && job.description) || '').trim(); // free in the list payload
  if (description) out.description = description;

  const posted = Date.parse((job && job.posted_at) || '');
  if (Number.isFinite(posted) && posted > 0) out.postedAt = posted;

  return out;
}

/** @type {Provider} */
export default {
  id: 'freehire',

  detect(entry) {
    return entry?.provider === 'freehire' ? { url: `${resolveBaseUrl()}/api/v1/jobs/search` } : null;
  },

  /**
   * Fetches and normalizes postings from the freehire.me public search API.
   * @param {{ name?: string, freehire?: any }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, maxPages?: number, sleep?: (ms: number) => Promise<void> }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const { keywords: ownKeywords, countries, regions, remote, isTech, postedWithinDays, pageSize } = parseFreehireConfig(entry);
    let keywords = ownKeywords;
    if (!keywords.length) keywords = resolveProfileKeywords();
    if (!keywords.length) {
      throw new Error(`freehire: entry "${entry.name || '(unnamed)'}" has no freehire.keywords[] and no config/profile.yml target_roles to fall back to`);
    }

    const baseUrl = resolveBaseUrl();
    const maxPages = Math.min(DEFAULT_MAX_PAGES, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
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

        const params = new URLSearchParams();
        params.set('q', keyword);
        params.set('limit', String(pageSize));
        params.set('offset', String(page * pageSize));
        for (const c of countries) params.append('countries', c);
        for (const r of regions) params.append('regions', r);
        if (remote) params.set('work_mode', 'remote');
        if (isTech) params.set('is_tech', isTech);
        if (postedWithinDays) params.set('posted_within_days', String(postedWithinDays));

        let json;
        try {
          // redirect:'error' prevents SSRF via a server-side redirect — load-
          // bearing here because baseUrl can come from FREEHIRE_API_URL.
          json = await ctx.fetchJson(`${baseUrl}/api/v1/jobs/search?${params.toString()}`, {
            redirect: 'error',
            timeoutMs: 15_000,
          });
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
