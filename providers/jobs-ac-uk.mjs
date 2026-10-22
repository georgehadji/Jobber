// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { intInRange } from './_config-utils.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

// jobs.ac.uk provider — the UK's largest academic board (lecturers, researchers, PhD studentships,
// professional-services roles at universities). Board-wide and keyless, so it is EXPLICIT-ONLY:
// detect() claims an entry only for `provider: jobs-ac-uk`. The site publishes no working feed
// (the RSS URLs 404/500), so the server-rendered search page is parsed instead. Configure with a
// `jobs_ac_uk:` block on a `job_boards:` entry:
//
//   - name: jobs.ac.uk
//     provider: jobs-ac-uk
//     jobs_ac_uk:
//       keywords: ["computer science", "machine learning"]  # optional — falls back to
//         # config/profile.yml target_roles; with neither, the newest jobs across all subjects
//       max_pages: 3        # 1–10 pages of 25 per keyword (default 3)
//     enabled: true
//
// Live probe 2026-10-22: /search/?keywords=physics&sortOrder=1&startIndex=26 → 200, 25 cards,
// "Page 2 of 13"; sortOrder=1 is newest first; pageSize is ignored (always 25). robots.txt only
// disallows /job/feedback/. The card shows "Date Placed: 22 Oct" with no year, so the year is
// inferred (a date still in the future means last year).
//
// shortcut: salary is left out — the card text is free-form ("£48,337 to £57,666 per annum",
// "Grade 7", "£15 per hour") and the Job contract wants an annualized number. Parse it when a
// user needs --min-salary on this board.

const ORIGIN = 'https://www.jobs.ac.uk';
const PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 3;
const INTER_PAGE_DELAY_MS = 300;
// Job ids always carry a digit (DTJ539); that excludes /job/feedback/, which robots.txt disallows.
const JOB_PATH_RE = /^\/job\/(?=[A-Za-z]*\d)[A-Za-z0-9]{3,12}\/[A-Za-z0-9_~%-][A-Za-z0-9._~%-]*$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** @param {string} html */
function text(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Epoch ms for a year-less "22 Oct" card date. A date more than a day ahead of `now` belongs to
 * the previous year (the board lists newest first, so a card is never dated in the future).
 * @param {string} label
 * @param {number} now
 * @returns {number | undefined}
 */
export function inferPostedAt(label, now = Date.now()) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})/.exec(label.trim());
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  const day = Number(m[1]);
  if (month < 0 || day < 1 || day > 31) return undefined;
  const year = new Date(now).getUTCFullYear();
  let ms = Date.UTC(year, month, day);
  if (new Date(ms).getUTCMonth() !== month) return undefined; // 31 Feb and friends roll over
  if (ms > now + 86_400_000) ms = Date.UTC(year - 1, month, day);
  return ms;
}

/**
 * Parse one jobs.ac.uk search page. Exported for unit tests.
 * @param {string} html
 * @param {number} [now]
 * @returns {{ jobs: Array<{title: string, url: string, company: string, location: string, postedAt?: number}>, page: number, pages: number }}
 */
export function parseSearchPage(html, now = Date.now()) {
  if (typeof html !== 'string') return { jobs: [], page: 1, pages: 1 };
  const jobs = [];
  for (const card of html.split('<div class="j-search-result__result').slice(1)) {
    const link = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(card);
    if (!link) continue;
    const path = decodeEntities(link[1]);
    const title = text(link[2]);
    if (!title || !JOB_PATH_RE.test(path)) continue;
    const employer = /j-search-result__employer">\s*<b>([\s\S]*?)<\/b>/.exec(card);
    const location = /<div>\s*Location:([\s\S]*?)<\/div>/.exec(card);
    const placed = /Date Placed:\s*<\/strong>([^<]*)/.exec(card);
    /** @type {any} */
    const job = {
      title,
      url: ORIGIN + path,
      company: employer ? text(employer[1]) : '',
      location: location ? text(location[1]) : '',
    };
    const postedAt = placed ? inferPostedAt(decodeEntities(placed[1]), now) : undefined;
    if (postedAt) job.postedAt = postedAt;
    jobs.push(job);
  }
  const pager = /Page\s+(\d+)\s+of\s+(\d+)/.exec(html);
  return { jobs, page: pager ? Number(pager[1]) : 1, pages: pager ? Number(pager[2]) : 1 };
}

/**
 * @param {string} keyword '' for no keyword filter
 * @param {number} page 1-based
 */
export function buildSearchUrl(keyword, page) {
  const q = new URLSearchParams();
  if (keyword) q.set('keywords', keyword);
  q.set('sortOrder', '1');
  if (page > 1) q.set('startIndex', String((page - 1) * PAGE_SIZE + 1));
  return `${ORIGIN}/search/?${q}`;
}

/**
 * @param {{ jobs_ac_uk?: any }} entry
 * @returns {{ keywords: string[], maxPages: number }}
 */
export function parseJobsAcUkConfig(entry) {
  const cfg = (entry && entry.jobs_ac_uk) || {};
  const keywords = [...new Set(
    (Array.isArray(cfg.keywords) ? cfg.keywords : [])
      .filter((/** @type {any} */ k) => typeof k === 'string' && k.trim())
      .map((/** @type {string} */ k) => k.trim()),
  )];
  return { keywords, maxPages: intInRange(cfg.max_pages, DEFAULT_MAX_PAGES, 1, 10) };
}

/** @type {Provider} */
export default {
  id: 'jobs-ac-uk',

  detect(entry) {
    return entry?.provider === 'jobs-ac-uk' ? { url: `${ORIGIN}/search/` } : null;
  },

  async fetch(entry, ctx) {
    const cfg = parseJobsAcUkConfig(/** @type {any} */ (entry));
    const own = cfg.keywords.length ? cfg.keywords : resolveProfileKeywords();
    const keywords = own.length ? own : ['']; // '' = newest across all subjects
    const maxPages = Math.min(cfg.maxPages, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
    const sleep = (/** @type {number} */ ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    /** @type {Map<string, any>} */
    const seen = new Map();
    const errors = [];
    let succeeded = 0;
    let firstRequest = true;
    for (const keyword of keywords) {
      let ok = false;
      for (let page = 1; page <= maxPages; page++) {
        if (firstRequest) firstRequest = false;
        else await sleep(INTER_PAGE_DELAY_MS);
        let parsed;
        try {
          // redirect:'error' keeps every request on www.jobs.ac.uk (SSRF); the URL is built here from a fixed origin.
          parsed = parseSearchPage(await ctx.fetchText(buildSearchUrl(keyword, page), { redirect: 'error', timeoutMs: 20_000 }));
        } catch (err) {
          errors.push(`"${keyword || '(all)'}": ${(err && /** @type {Error} */ (err).message) || err}`);
          break; // keep what this keyword already yielded; try the next one
        }
        ok = true;
        for (const job of parsed.jobs) if (!seen.has(job.url)) seen.set(job.url, job);
        if (parsed.jobs.length < PAGE_SIZE || parsed.page >= parsed.pages) break;
      }
      if (ok) succeeded++;
    }
    // Total outage = every keyword's first request failed (zero results is not an outage).
    if (succeeded === 0 && errors.length) {
      throw new Error(`jobs-ac-uk: all ${keywords.length} request(s) failed — ${errors[0]}`);
    }
    return [...seen.values()];
  },
};
