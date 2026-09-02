// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { intInRange } from './_config-utils.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

// APEC (Association Pour l'Emploi des Cadres) provider — France's national
// board for cadre/executive roles. Hits the public `rechercheOffre`
// webservice apec.fr's own frontend uses (verified live 2026-08-30: POST
// returns 200 with no key). Closes the sharpest provider gap in the repo:
// Jobber ships a full French market mode set (`modes/fr/`) with zero French
// provider until now.
//
// Configure via a `job_boards` (or `tracked_companies`) entry with
// `provider: apec` and an `apec:` block:
//
//   - name: APEC — Machine Learning
//     provider: apec
//     apec:
//       keywords: ["Machine Learning Engineer", "Data Scientist"]  # optional —
//         # falls back to config/profile.yml target_roles when omitted
//       page_size: 100   # results per keyword page (1–100; default 100)
//     enabled: true
//
// KNOWN GAP — detail URL is best-effort, not verified: the search webservice
// carries no ready-made link, only a bare `numeroOffre`. The plausible
// permalink (`/candidat/recherche-emploi.html/emploi/detail-offre/{id}`) is
// apec.fr's own Angular route, but the site is client-side rendered and
// returns HTTP 200 for that path with ANY id — real or garbage — so a 200
// response is not evidence the id resolves to the right posting. The only
// per-offer JSON detail endpoint found during research
// (`/cms/webservices/offre/public/{id}`) sits behind DataDome bot-protection
// (403, JS challenge) and could not be probed. Spot-check a generated URL in
// a real browser before relying on this provider for anything automated
// downstream of the link itself (e.g. an `apply` flow).
//
// Salary parsing is intentionally narrow: `salaireTexte` is only converted
// to a Job.salary when it explicitly says "brut annuel" in k€ — any other
// wording (mensuel, jour, TJM, no interval at all) is left unparsed rather
// than guessed, per the Job contract's annualization rule (_types.js).

const API_URL = 'https://www.apec.fr/cms/webservices/rechercheOffre';
const DETAIL_HOST = 'www.apec.fr';
const DETAIL_BASE = `https://${DETAIL_HOST}/candidat/recherche-emploi.html/emploi/detail-offre/`;
const NUMERO_OFFRE_RE = /^[0-9]+[A-Za-z]?$/;
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_TYPE_CLIENT = 'CADRE';
// Every request after the first pays it (same idiom as tencent.mjs/avature.mjs).
const INTER_PAGE_DELAY_MS = 150;

/**
 * Reads and sanitizes the entry's `apec:` config block.
 * @param {{ apec?: any }} entry
 * @returns {{ keywords: string[], pageSize: number, typeClient: string }}
 */
export function parseApecConfig(entry) {
  const cfg = (entry && entry.apec) || {};
  const keywords = [...new Set(
    (Array.isArray(cfg.keywords) ? cfg.keywords : [])
      .filter(k => typeof k === 'string' && k.trim())
      .map(k => k.trim()),
  )];
  return {
    keywords,
    pageSize: intInRange(cfg.page_size, 100, 1, 100),
    typeClient: typeof cfg.type_client === 'string' && cfg.type_client.trim() ? cfg.type_client.trim() : DEFAULT_TYPE_CLIENT,
  };
}

/**
 * Parses `salaireTexte` into an annualized EUR Job.salary — only when the
 * text explicitly states an annual gross (k€, "brut annuel") figure. Any
 * other interval (mensuel, jour, TJM) or a string with no interval word at
 * all returns undefined rather than a guessed figure.
 * @param {unknown} value
 * @returns {({min: number, max: number, currency: string}) | undefined}
 */
export function parseApecSalary(value) {
  const raw = String(value || '').trim();
  if (!raw || !/brut\s+annuel/i.test(raw)) return undefined;
  if (/(mensuel|par\s+jour|\bTJM\b)/i.test(raw)) return undefined;

  const toNumber = (s) => parseFloat(String(s).replace(',', '.'));

  const range = raw.match(/(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*k\s*€/i);
  if (range) {
    const min = Math.round(toNumber(range[1]) * 1000);
    const max = Math.round(toNumber(range[2]) * 1000);
    if (Number.isFinite(min) && Number.isFinite(max)) return { min, max, currency: 'EUR' };
  }

  const single = raw.match(/(\d+(?:[.,]\d+)?)\s*k\s*€/i);
  if (single) {
    const val = Math.round(toNumber(single[1]) * 1000);
    if (Number.isFinite(val)) return { min: val, max: val, currency: 'EUR' };
  }

  return undefined;
}

/**
 * Normalizes one raw `resultats[]` record into a Job. Returns null when the
 * posting lacks a usable title or a valid `numeroOffre`.
 * @param {any} hit
 * @returns {({title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: {min: number, max: number, currency: string}}) | null}
 */
export function normalizeJob(hit) {
  const title = String((hit && hit.intitule) || '').trim(); // never intituleSurbrillance — carries <em> markup
  const numeroOffre = String((hit && hit.numeroOffre) || '').trim();
  if (!title || !NUMERO_OFFRE_RE.test(numeroOffre)) return null;

  const job = {
    title,
    url: DETAIL_BASE + encodeURIComponent(numeroOffre),
    company: String((hit && hit.nomCommercial) || '').trim(),
    location: String((hit && hit.lieuTexte) || '').trim(),
  };

  const teaser = String((hit && hit.texteOffre) || '').trim(); // free in the list payload
  if (teaser) job.description = teaser;

  const posted = Date.parse((hit && (hit.datePublication || hit.dateValidation)) || '');
  if (Number.isFinite(posted)) job.postedAt = posted;

  const salary = parseApecSalary(hit && hit.salaireTexte);
  if (salary) job.salary = salary;

  return job;
}

/** @type {Provider} */
export default {
  id: 'apec',

  detect(entry) {
    return entry?.provider === 'apec' ? { url: API_URL } : null;
  },

  /**
   * Fetches and normalizes postings from the apec.fr rechercheOffre webservice.
   * @param {{ name?: string, apec?: any }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, maxPages?: number, sleep?: (ms: number) => Promise<void> }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: object}>>}
   */
  async fetch(entry, ctx) {
    const { keywords: ownKeywords, pageSize, typeClient } = parseApecConfig(entry);
    let keywords = ownKeywords;
    if (!keywords.length) keywords = resolveProfileKeywords();
    if (!keywords.length) {
      throw new Error(`apec: entry "${entry.name || '(unnamed)'}" has no apec.keywords[] and no config/profile.yml target_roles to fall back to`);
    }

    const maxPages = Math.min(DEFAULT_MAX_PAGES, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
    const sleep = (ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    /** @type {Map<string, import('./_types.js').Job>} */
    const seen = new Map();
    const errors = [];
    let succeeded = 0;
    let firstRequest = true;

    for (const motsCles of keywords) {
      let keywordSucceeded = false;
      let totalCount = Infinity;
      for (let page = 0; page < maxPages && page * pageSize < totalCount; page++) {
        if (firstRequest) firstRequest = false;
        else await sleep(INTER_PAGE_DELAY_MS);

        const body = JSON.stringify({
          motsCles,
          typeClient,
          sorts: [{ type: 'SCORE', direction: 'DESCENDING' }],
          pagination: { range: pageSize, startIndex: page * pageSize },
          activeFiltre: true,
        });

        let json;
        try {
          // redirect:'error' prevents SSRF via a server-side redirect.
          json = await ctx.fetchJson(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', accept: 'application/json' },
            body,
            redirect: 'error',
            timeoutMs: 12_000,
          });
        } catch (err) {
          errors.push(`"${motsCles}": ${(err && err.message) || err}`);
          break; // try the next keyword; keep whatever this one already yielded
        }
        keywordSucceeded = true;

        const results = Array.isArray(json && json.resultats) ? json.resultats : [];
        if (Number.isFinite(json && json.totalCount)) totalCount = json.totalCount;
        if (results.length === 0) break;

        for (const hit of results) {
          const job = normalizeJob(hit);
          if (job && !seen.has(job.url)) seen.set(job.url, job);
        }
      }
      if (keywordSucceeded) succeeded++;
    }

    // Total outage = every keyword's first request failed. A keyword that
    // answered with zero results is not an outage.
    if (succeeded === 0 && errors.length) {
      throw new Error(`apec: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...seen.values()];
  },
};
