// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { intInRange } from './_config-utils.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

// Arbetsförmedlingen (Swedish Public Employment Service) provider — hits the
// public JobTech JobSearch API (jobsearch.api.jobtechdev.se), the same
// open-data backend behind Platsbanken. Zero-auth: verified live 2026-08-30,
// `GET /search?q=...` returns 200 with no API key and no header. One or more
// keywords are queried; scan.mjs applies title_filter + location_filter +
// dedup afterwards, so this provider over-fetches (recall-first) — same
// philosophy as arbeitsagentur.mjs / vdab.mjs.
//
// Configure via a `job_boards` (or `tracked_companies`) entry with
// `provider: arbetsformedlingen` and an `arbetsformedlingen:` block:
//
//   - name: Arbetsförmedlingen — Machine Learning
//     provider: arbetsformedlingen
//     arbetsformedlingen:
//       keywords: ["Machine Learning Engineer", "Data Scientist"]  # optional —
//         # falls back to config/profile.yml target_roles when omitted
//       limit: 100   # results per keyword page (1–100, API max; default 100)
//     enabled: true
//
// Known gap: the API exposes only a taxonomy `salary_type` concept (e.g.
// "Fast månads- vecko- eller timlön") and a free-text nullable
// `salary_description` — no numeric bounds and no reliable interval. Per the
// Job contract's annualization rule (_types.js), `salary` is never emitted
// here rather than guessed.

const API_HOST = 'jobsearch.api.jobtechdev.se';
const API_URL = `https://${API_HOST}/search`;
const JOB_HOST = 'arbetsformedlingen.se';
const DEFAULT_MAX_PAGES = 3;
// Every request after the first pays it (same idiom as tencent.mjs/avature.mjs).
const INTER_PAGE_DELAY_MS = 150;

/**
 * Reads and sanitizes the entry's `arbetsformedlingen:` config block.
 * @param {{ arbetsformedlingen?: any }} entry
 * @returns {{ keywords: string[], limit: number }}
 */
export function parseArbetsformedlingenConfig(entry) {
  const cfg = (entry && entry.arbetsformedlingen) || {};
  const keywords = [...new Set(
    (Array.isArray(cfg.keywords) ? cfg.keywords : [])
      .filter(k => typeof k === 'string' && k.trim())
      .map(k => k.trim()),
  )];
  return {
    keywords,
    limit: intInRange(cfg.limit, 100, 1, 100), // API max page size is 100
  };
}

/**
 * Assembles a human-readable location from `workplace_address`. Most
 * postings are in Sweden; only a non-Sweden country is appended so the
 * downstream location_filter can act on it (same omit-home-country rule as
 * arbeitsagentur.mjs's buildLocation).
 * @param {any} address
 */
export function buildLocation(address) {
  if (!address || typeof address !== 'object') return '';
  const loc = [address.municipality, address.region].filter(Boolean).join(', ');
  const country = address.country;
  if (country && !/sverige|sweden/i.test(String(country))) {
    return loc ? `${loc}, ${country}` : String(country);
  }
  return loc;
}

/**
 * Validates and returns a job's own `webpage_url` — remote-supplied, so it
 * must be pinned to the trusted host before it can end up clickable in
 * pipeline.md (same discipline as himalayas.mjs's cleanHimalayasUrl).
 * @param {unknown} value
 */
function cleanJobUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:') return '';
  const host = parsed.hostname.toLowerCase();
  return host === JOB_HOST || host.endsWith(`.${JOB_HOST}`) ? parsed.href : '';
}

/**
 * Normalizes one raw JobSearch API hit into a Job. Returns null when the
 * posting lacks a usable title or a trusted webpage_url.
 * @param {any} hit
 * @returns {({title: string, url: string, company: string, location: string, description?: string, postedAt?: number}) | null}
 */
export function normalizeJob(hit) {
  const title = String((hit && hit.headline) || '').trim();
  const url = cleanJobUrl(hit && hit.webpage_url);
  if (!title || !url) return null;

  const job = {
    title,
    url,
    company: String((hit && hit.employer && (hit.employer.name || hit.employer.workplace)) || '').trim(),
    location: buildLocation(hit && hit.workplace_address),
  };

  // Carried free in the list payload — populate it so content_filter works.
  const bodyText = String((hit && hit.description && hit.description.text) || '').trim();
  if (bodyText) job.description = bodyText;

  const posted = Date.parse((hit && hit.publication_date) || '');
  if (Number.isFinite(posted)) job.postedAt = posted;

  return job;
}

/** @type {Provider} */
export default {
  id: 'arbetsformedlingen',

  detect(entry) {
    return entry?.provider === 'arbetsformedlingen' ? { url: API_URL } : null;
  },

  /**
   * Fetches and normalizes postings from the JobTech JobSearch API.
   * @param {{ name?: string, arbetsformedlingen?: any }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, maxPages?: number, sleep?: (ms: number) => Promise<void> }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const { keywords: ownKeywords, limit } = parseArbetsformedlingenConfig(entry);
    let keywords = ownKeywords;
    if (!keywords.length) keywords = resolveProfileKeywords();
    if (!keywords.length) {
      throw new Error(`arbetsformedlingen: entry "${entry.name || '(unnamed)'}" has no arbetsformedlingen.keywords[] and no config/profile.yml target_roles to fall back to`);
    }

    const entryMaxPages = DEFAULT_MAX_PAGES;
    const maxPages = Math.min(entryMaxPages, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
    const sleep = (ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    /** @type {Map<string, import('./_types.js').Job>} */
    const seen = new Map();
    const errors = [];
    let succeeded = 0;
    let firstRequest = true;

    for (const q of keywords) {
      let keywordSucceeded = false;
      for (let page = 0; page < maxPages; page++) {
        if (firstRequest) firstRequest = false;
        else await sleep(INTER_PAGE_DELAY_MS);

        const params = new URLSearchParams({ q, limit: String(limit), offset: String(page * limit) });
        let json;
        try {
          // redirect:'error' prevents SSRF via a server-side redirect.
          json = await ctx.fetchJson(`${API_URL}?${params.toString()}`, {
            headers: { accept: 'application/json' },
            redirect: 'error',
            timeoutMs: 12_000,
          });
        } catch (err) {
          errors.push(`"${q}": ${(err && err.message) || err}`);
          break; // try the next keyword; keep whatever this one already yielded
        }
        keywordSucceeded = true;

        const hits = Array.isArray(json && json.hits) ? json.hits : [];
        if (hits.length === 0) break;

        for (const hit of hits) {
          const job = normalizeJob(hit);
          if (job && !seen.has(job.url)) seen.set(job.url, job);
        }

        if (hits.length < limit) break; // short page → done with this keyword
      }
      if (keywordSucceeded) succeeded++;
    }

    // Total outage = every keyword's first request failed. A keyword that
    // answered with zero results is not an outage.
    if (succeeded === 0 && errors.length) {
      throw new Error(`arbetsformedlingen: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...seen.values()];
  },
};
