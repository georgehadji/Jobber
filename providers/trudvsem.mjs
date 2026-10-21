// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { intInRange } from './_config-utils.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

// Trudvsem ("Работа России") provider — the open-data API of the Russian
// federal employment service's job board (opendata.trudvsem.ru). Board-wide and
// keyless, so it is EXPLICIT-ONLY: detect() claims an entry only for
// `provider: trudvsem`. Configure via a `job_boards` (or `tracked_companies`)
// entry with a `trudvsem:` block:
//
//   - name: Trudvsem — Russia
//     provider: trudvsem
//     trudvsem:
//       keywords: ["Python", "аналитик данных"]  # optional — falls back to
//         # config/profile.yml target_roles when omitted. The board is
//         # Russian-language: Cyrillic keywords match far more postings.
//       region: "7700000000000"   # optional 13-digit OKATO code (Moscow);
//         # omit for all of Russia
//       page_size: 100            # 1–100 (API max; default 100)
//     enabled: true
//
// PROVENANCE: adapted from github.com/strelov1/freehire
// internal/ingest/sources/trudvsem.go (MIT). The Go adapter enumerates a region
// without a text filter; this port adds the API's `text=` query so keywords
// narrow the board. Live probe 2026-10-21:
// https://opendata.trudvsem.ru/api/v1/vacancies?text=python → 200, total 400;
// /vacancies/region/7700000000000?text=python → 200, total 127; no auth.
//
// The API pages by 0-based page INDEX (`offset` is a page number, not a record
// offset) and 500s on a page past the end, so the loop stops on a short page or
// once the reported total is covered.
//
// Salary: the payload's salary_min/salary_max carry no stated period (and
// salary_max mirrors salary_min for "от X" ads), so `salary` is deliberately
// omitted (annualization rule, _types.js).

const BASE = 'https://opendata.trudvsem.ru/api/v1/vacancies';
const REGION_RE = /^\d{13}$/;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const VAC_HOSTS = new Set(['trudvsem.ru', 'www.trudvsem.ru']);
const DEFAULT_MAX_PAGES = 3;
const INTER_PAGE_DELAY_MS = 200;

/**
 * Reads and sanitizes the entry's `trudvsem:` config block.
 * @param {{ trudvsem?: any }} entry
 * @returns {{ keywords: string[], region: string | null, pageSize: number }}
 */
export function parseTrudvsemConfig(entry) {
  const cfg = (entry && entry.trudvsem) || {};
  const keywords = [...new Set(
    (Array.isArray(cfg.keywords) ? cfg.keywords : [])
      .filter((/** @type {any} */ k) => typeof k === 'string' && k.trim())
      .map((/** @type {string} */ k) => k.trim()),
  )];
  const region = REGION_RE.test(String(cfg.region ?? '').trim()) ? String(cfg.region).trim() : null;
  return { keywords, region, pageSize: intInRange(cfg.page_size, 100, 1, 100) };
}

/**
 * Build one search-page URL (`page` is the API's 0-based page index).
 * @param {string | null} region
 * @param {string} keyword
 * @param {number} pageSize
 * @param {number} page
 */
export function buildTrudvsemUrl(region, keyword, pageSize, page) {
  const q = new URLSearchParams({ text: keyword, limit: String(pageSize), offset: String(page) });
  return `${BASE}${region ? `/region/${region}` : ''}?${q}`;
}

/** @param {string} url */
function assertTrudvsemUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`trudvsem: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:' || u.hostname !== 'opendata.trudvsem.ru' || u.port) {
    throw new Error(`trudvsem: untrusted URL "${url}" — must be https://opendata.trudvsem.ru/…`);
  }
  return url;
}

/**
 * Normalize one `results.vacancies[].vacancy` record. Returns null when the
 * posting lacks an id, a title, or an https trudvsem.ru posting URL.
 * Exported for unit tests.
 * @param {any} v
 * @param {string} companyName fallback employer
 * @returns {({title: string, url: string, company: string, location: string, description?: string, postedAt?: number}) | null}
 */
export function normalizeTrudvsemVacancy(v, companyName) {
  const id = String(v?.id ?? '');
  const title = String(v?.['job-name'] ?? '').trim();
  if (!ID_RE.test(id) || !title) return null;
  let url;
  try {
    const u = new URL(String(v['vac_url'] ?? '').trim());
    if (u.protocol !== 'https:' || !VAC_HOSTS.has(u.hostname) || u.port) return null;
    url = u.href;
  } catch {
    return null;
  }
  const job = /** @type {any} */ ({
    title,
    url,
    company: String(v?.company?.name ?? '').trim() || companyName,
    location: String(v?.region?.name ?? '').trim(),
  });
  // duty / requirements are plain text, free in the list payload.
  const duty = String(v?.duty ?? '').trim();
  const req = String(v?.requirements ?? '').trim();
  const description = [duty && `Обязанности:\n${duty}`, req && `Требования:\n${req}`].filter(Boolean).join('\n\n');
  if (description) job.description = description;
  const posted = Date.parse(String(v?.['creation-date'] ?? '').trim());
  if (Number.isFinite(posted)) job.postedAt = posted;
  return job;
}

/** @type {Provider} */
export default {
  id: 'trudvsem',

  detect(entry) {
    return entry?.provider === 'trudvsem' ? { url: BASE } : null;
  },

  async fetch(entry, ctx) {
    const { keywords: ownKeywords, region, pageSize } = parseTrudvsemConfig(/** @type {any} */ (entry));
    const keywords = ownKeywords.length ? ownKeywords : resolveProfileKeywords();
    if (!keywords.length) {
      throw new Error(`trudvsem: entry "${entry.name || '(unnamed)'}" has no trudvsem.keywords[] and no config/profile.yml target_roles to fall back to`);
    }
    const maxPages = Math.min(DEFAULT_MAX_PAGES, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
    const sleep = (/** @type {number} */ ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    /** @type {Map<string, any>} */
    const seen = new Map();
    const errors = [];
    let succeeded = 0;
    let firstRequest = true;
    for (const keyword of keywords) {
      let ok = false;
      for (let page = 0; page < maxPages; page++) {
        if (firstRequest) firstRequest = false;
        else await sleep(INTER_PAGE_DELAY_MS);
        /** @type {any} */
        let json;
        try {
          // redirect:'error' + the host check keep every request on opendata.trudvsem.ru (SSRF).
          json = await ctx.fetchJson(assertTrudvsemUrl(buildTrudvsemUrl(region, keyword, pageSize, page)), { redirect: 'error', timeoutMs: 20_000 });
        } catch (err) {
          errors.push(`"${keyword}": ${(err && /** @type {Error} */ (err).message) || err}`);
          break; // keep what this keyword already yielded; try the next one
        }
        ok = true;
        const rows = Array.isArray(json?.results?.vacancies) ? json.results.vacancies : [];
        for (const row of rows) {
          const job = normalizeTrudvsemVacancy(row?.vacancy, entry.name);
          if (job && !seen.has(job.url)) seen.set(job.url, job);
        }
        const total = Number(json?.meta?.total);
        if (rows.length < pageSize || (Number.isFinite(total) && (page + 1) * pageSize >= total)) break;
      }
      if (ok) succeeded++;
    }
    // Total outage = every keyword's first request failed (zero results is not an outage).
    if (succeeded === 0 && errors.length) {
      throw new Error(`trudvsem: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }
    return [...seen.values()];
  },
};
