// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { intInRange } from './_config-utils.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';
import { decodeEntities } from './_html-entities.mjs';

// EURES (European Job Mobility Portal) provider — hits the public job-search
// webservice behind europa.eu/eures. Verified live 2026-08-30: POST returns
// 200 with no key, `numberRecords: 403027`. One provider covers every EU/EEA
// national employment service Jobber has a market mode for (DE, FR) plus
// every one it doesn't (ES, IT, PL, NL, ...), with per-country filtering
// built into the query.
//
// Configure via a `job_boards` (or `tracked_companies`) entry with
// `provider: eures` and an `eures:` block:
//
//   - name: EURES — Machine Learning (DE/AT)
//     provider: eures
//     eures:
//       keywords: ["Machine Learning Engineer", "Data Scientist"]  # optional —
//         # falls back to config/profile.yml target_roles when omitted
//       location_codes: ["de", "at"]  # optional ISO country codes; omit for EU-wide
//       publication_period: LAST_WEEK # optional: LAST_DAY | LAST_WEEK | LAST_MONTH
//       page_size: 50    # results per keyword page (1–50; API max; default 50)
//       request_language: en  # language of returned text fields (default 'en')
//     enabled: true
//
// PROVENANCE: the request schema comes from a community-maintained,
// REVERSE-ENGINEERED OpenAPI spec (rorar.github.io/EURES-API-Documentation)
// — not an official, guaranteed-stable API. The live probe on 2026-08-30,
// not the spec, is the source of truth here; treat a future breaking change
// as expected, not a bug.
//
// KNOWN GAP: `locationMap` in the response is `{countryCode: [nutsCodes]}`
// (e.g. `{"DE": ["DE138"]}`), not a resolvable city name — resolving NUTS
// codes to place names would cost a second network call per posting, which
// breaks the zero-token/no-per-job-request rule. `location` is therefore the
// bare country code(s) only; scan.mjs's location_filter should target country
// rather than city for this provider.
//
// No numeric `salary` field is present in the search payload — omitted
// entirely per the Job contract's annualization rule (_types.js).

const API_URL = 'https://europa.eu/eures/api/jv-searchengine/public/jv-search/search';
const DETAIL_HOST = 'europa.eu';
const DETAIL_BASE = `https://${DETAIL_HOST}/eures/portal/jv-se/jv-details/`;
// EURES job ids are opaque, base64-ish tokens (e.g.
// "MTM2MzUtYTgxNGE1ZjFfSkI1MjE1ODY4LVMgMQ") — validated before being
// interpolated into a URL, since the id comes straight from the response.
const JOB_ID_RE = /^[A-Za-z0-9_\-+=/]{8,256}$/;
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_REQUEST_LANGUAGE = 'en';
// Every request after the first pays it (same idiom as tencent.mjs/avature.mjs).
const INTER_PAGE_DELAY_MS = 150;

/**
 * Reads and sanitizes the entry's `eures:` config block.
 * @param {{ eures?: any }} entry
 * @returns {{ keywords: string[], locationCodes: string[], publicationPeriod: string|null, pageSize: number, requestLanguage: string }}
 */
export function parseEuresConfig(entry) {
  const cfg = (entry && entry.eures) || {};
  const keywords = [...new Set(
    (Array.isArray(cfg.keywords) ? cfg.keywords : [])
      .filter(k => typeof k === 'string' && k.trim())
      .map(k => k.trim()),
  )];
  const locationCodes = (Array.isArray(cfg.location_codes) ? cfg.location_codes : [])
    .filter(c => typeof c === 'string' && c.trim())
    .map(c => c.trim().toLowerCase());
  const ALLOWED_PERIODS = new Set(['LAST_DAY', 'LAST_WEEK', 'LAST_MONTH']);
  const publicationPeriod = ALLOWED_PERIODS.has(cfg.publication_period) ? cfg.publication_period : null;
  return {
    keywords,
    locationCodes,
    publicationPeriod,
    pageSize: intInRange(cfg.page_size, 50, 1, 50), // API max page size is 50
    requestLanguage: typeof cfg.request_language === 'string' && cfg.request_language.trim()
      ? cfg.request_language.trim()
      : DEFAULT_REQUEST_LANGUAGE,
  };
}

/** Strips HTML tags/entities from EURES' free-text description field. */
function stripHtml(raw) {
  const s = String(raw || '');
  if (!s || !/[<&]/.test(s)) return s.trim();
  let cleaned = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n');
  let prev;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(/<[^>]+>/g, '');
  } while (cleaned !== prev);
  return decodeEntities(cleaned).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Renders `locationMap` (`{countryCode: [nutsCodes]}`) as the joined country
 * code list. See the module header's "KNOWN GAP" note.
 * @param {any} locationMap
 */
export function buildLocation(locationMap) {
  if (!locationMap || typeof locationMap !== 'object') return '';
  return Object.keys(locationMap).filter(Boolean).join(', ');
}

/**
 * Normalizes one raw `jvs[]` record into a Job. Returns null when the
 * posting lacks a usable title or a valid job id.
 * @param {any} jv
 * @returns {({title: string, url: string, company: string, location: string, description?: string, postedAt?: number}) | null}
 */
export function normalizeJob(jv) {
  const title = String((jv && jv.title) || '').trim();
  const id = String((jv && jv.id) || '').trim();
  if (!title || !JOB_ID_RE.test(id)) return null;

  const job = {
    title,
    url: DETAIL_BASE + encodeURIComponent(id) + '?lang=en',
    company: String((jv && jv.employer && jv.employer.name) || '').trim(),
    location: buildLocation(jv && jv.locationMap),
  };

  const description = stripHtml(jv && jv.description); // free in the list payload
  if (description) job.description = description;

  // creationDate is already epoch ms (confirmed live) — never multiplied.
  const posted = Number(jv && jv.creationDate);
  if (Number.isFinite(posted) && posted > 0) job.postedAt = posted;

  return job;
}

/** @type {Provider} */
export default {
  id: 'eures',

  detect(entry) {
    return entry?.provider === 'eures' ? { url: API_URL } : null;
  },

  /**
   * Fetches and normalizes postings from the EURES public search API.
   * @param {{ name?: string, eures?: any }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, maxPages?: number, sleep?: (ms: number) => Promise<void> }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const { keywords: ownKeywords, locationCodes, publicationPeriod, pageSize, requestLanguage } = parseEuresConfig(entry);
    let keywords = ownKeywords;
    if (!keywords.length) keywords = resolveProfileKeywords();
    if (!keywords.length) {
      throw new Error(`eures: entry "${entry.name || '(unnamed)'}" has no eures.keywords[] and no config/profile.yml target_roles to fall back to`);
    }

    const maxPages = Math.min(DEFAULT_MAX_PAGES, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
    const sleep = (ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    /** @type {Map<string, import('./_types.js').Job>} */
    const seen = new Map();
    const errors = [];
    let succeeded = 0;
    let firstRequest = true;

    for (const keyword of keywords) {
      let keywordSucceeded = false;
      for (let page = 1; page <= maxPages; page++) {
        if (firstRequest) firstRequest = false;
        else await sleep(INTER_PAGE_DELAY_MS);

        const body = JSON.stringify({
          resultsPerPage: pageSize,
          page,
          sortSearch: 'BEST_MATCH',
          keywords: [{ keyword, specificSearchCode: 'EVERYWHERE' }],
          publicationPeriod,
          occupationUris: [],
          skillUris: [],
          requiredExperienceCodes: [],
          positionScheduleCodes: [],
          sectorCodes: [],
          educationAndQualificationLevelCodes: [],
          positionOfferingCodes: [],
          locationCodes,
          euresFlagCodes: [],
          otherBenefitsCodes: [],
          requiredLanguages: [],
          minNumberPost: null,
          sessionId: 'jobber',
          userPreferredLanguage: null,
          requestLanguage,
        });

        let json;
        try {
          // redirect:'error' prevents SSRF via a server-side redirect.
          json = await ctx.fetchJson(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', accept: 'application/json' },
            body,
            redirect: 'error',
            timeoutMs: 15_000,
          });
        } catch (err) {
          errors.push(`"${keyword}": ${(err && err.message) || err}`);
          break; // try the next keyword; keep whatever this one already yielded
        }
        keywordSucceeded = true;

        const jvs = Array.isArray(json && json.jvs) ? json.jvs : [];
        if (jvs.length === 0) break;

        for (const jv of jvs) {
          const job = normalizeJob(jv);
          if (job && !seen.has(job.url)) seen.set(job.url, job);
        }

        if (jvs.length < pageSize) break; // short page → done with this keyword
      }
      if (keywordSucceeded) succeeded++;
    }

    // Total outage = every keyword's first request failed. A keyword that
    // answered with zero results is not an outage.
    if (succeeded === 0 && errors.length) {
      throw new Error(`eures: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...seen.values()];
  },
};
