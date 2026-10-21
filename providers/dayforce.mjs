// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';

// Dayforce (formerly Ceridian) career-site provider — keyless POST JSON search
// behind a next-auth double-submit CSRF pair fetched anonymously in the same
// run. Provenance: ported from github.com/strelov1/freehire
// internal/ingest/sources/dayforce.go (MIT). Live-probed 2026-10-21 against
// https://jobs.dayforcehcm.com/en-US/dcrusa/join-us (125 postings, 200,
// no login).
//
// Auto-detects from careers_url
// `https://jobs.dayforcehcm.com/[<xx-XX culture>/]<tenant>/<site>[/jobs/<id>]`
// (every Dayforce career site is served from that one host). Flow:
//   1. GET  /api/auth/csrf -> { csrfToken } + Set-Cookie __Host-next-auth.csrf-token
//   2. POST /api/geo/<tenant>/jobposting/search with header X-CSRF-TOKEN and
//      that cookie; body { clientNamespace, jobBoardCode, cultureCode,
//      paginationStart } -> { jobPostings[], maxCount }, 25 per page.
// The listing carries each posting's whole description (entity-encoded plain
// text), date and locations, so no per-job request is needed. No salary.
//
// ctx.fetchJson/fetchText expose only response bodies, never Set-Cookie, so
// step 1 alone uses `ctx.fetchResponse(url, opts)` when a context supplies one
// (tests do), else the platform `fetch` with a 10s timeout and redirect:'error'.
// Only the fixed Dayforce host is ever contacted.

const DAYFORCE_ORIGIN = 'https://jobs.dayforcehcm.com';
const DAYFORCE_HOST = 'jobs.dayforcehcm.com';
const LOCALE_RE = /^[a-z]{2}-[A-Za-z]{2}$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const NOT_BOARD = new Set(['api', '_next']);
const DEFAULT_CULTURE = 'en-US';
const PAGE_SIZE = 25; // fixed by the platform: the request carries only an offset
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_CAP = 200;
const PAGE_DELAY_MS = 300;
const CSRF_COOKIE = '__Host-next-auth.csrf-token=';

/**
 * Parse a Dayforce career-site URL into its coordinates, or null.
 * @param {unknown} raw
 * @returns {{tenant: string, site: string, culture: string} | null}
 */
export function parseDayforceUrl(raw) {
  if (typeof raw !== 'string') return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== DAYFORCE_HOST || u.port || u.username || u.password) return null;
  let segs = u.pathname.split('/').filter(Boolean);
  let culture = DEFAULT_CULTURE;
  if (segs.length > 0 && LOCALE_RE.test(segs[0])) {
    culture = segs[0];
    segs = segs.slice(1);
  }
  if (segs.length < 2 || NOT_BOARD.has(segs[0].toLowerCase())) return null;
  const [tenant, site] = segs;
  if (!NAME_RE.test(tenant) || !NAME_RE.test(site)) return null;
  return { tenant, site, culture };
}

/** @param {{tenant: string}} b */
const searchUrl = (b) => `${DAYFORCE_ORIGIN}/api/geo/${b.tenant}/jobposting/search`;

/**
 * One address as "City, State, CC", skipping blanks.
 * @param {any} a
 */
const addressLabel = (a) =>
  [a?.cityName, a?.stateCode, a?.isoCountryCode].filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).join(', ');

/**
 * Normalize one search page's postings. Exported for unit tests. Rows without
 * a positive jobPostingId or a title are dropped.
 * @param {any} json
 * @param {{tenant: string, site: string, culture: string}} board
 * @param {string} companyName
 * @returns {Array<import('./_types.js').Job>}
 */
export function parseDayforcePage(json, board, companyName) {
  const rows = json?.jobPostings;
  if (!Array.isArray(rows)) return [];
  /** @type {Array<import('./_types.js').Job>} */
  const out = [];
  for (const p of rows) {
    const id = Number(p?.jobPostingId);
    const title = typeof p?.jobTitle === 'string' ? p.jobTitle.trim() : '';
    if (!Number.isInteger(id) || id <= 0 || !title) continue;
    const places = [...new Set((Array.isArray(p.postingLocations) ? p.postingLocations : []).map(addressLabel).filter(Boolean))];
    let location = places.join('; ');
    if (p.hasVirtualLocation === true && !/remote/i.test(location)) location = location ? `${location}; Remote` : 'Remote';
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: `${DAYFORCE_ORIGIN}/${board.culture}/${board.tenant}/${board.site}/jobs/${id}`,
      company: companyName,
      location,
    };
    if (typeof p.jobDescription === 'string' && p.jobDescription.trim()) {
      job.description = decodeEntities(p.jobDescription).trim();
    }
    const t = typeof p.postingStartTimestampUTC === 'string' ? Date.parse(p.postingStartTimestampUTC) : NaN;
    if (Number.isFinite(t)) job.postedAt = t;
    out.push(job);
  }
  return out;
}

/**
 * Mint the anonymous CSRF pair. Returns the header token and the cookie
 * (`name=value`) that must accompany it.
 * @param {(url: string, opts: any) => Promise<any>} fetchResponse
 * @returns {Promise<{token: string, cookie: string}>}
 */
export async function bootstrapCsrf(fetchResponse) {
  const res = await fetchResponse(`${DAYFORCE_ORIGIN}/api/auth/csrf`, {
    redirect: 'error',
    headers: { accept: 'application/json' },
  });
  if (!res?.ok) {
    const err = /** @type {any} */ (new Error(`dayforce: csrf bootstrap HTTP ${res?.status}`));
    err.status = res?.status;
    throw err;
  }
  const body = await res.json();
  const cookies = typeof res.headers?.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const pair = cookies.map((/** @type {string} */ c) => c.split(';')[0].trim()).find((/** @type {string} */ c) => c.startsWith(CSRF_COOKIE));
  const token = body?.csrfToken;
  if (typeof token !== 'string' || !token || !pair) throw new Error('dayforce: csrf bootstrap issued no token/cookie');
  return { token, cookie: pair };
}

/** Default bootstrap transport: platform fetch pinned to the Dayforce host. */
/** @type {(url: string, opts: any) => Promise<any>} */
const defaultFetchResponse = (url, opts) =>
  globalThis.fetch(url, {
    ...opts,
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; jobber/1.3)', ...opts?.headers },
    signal: AbortSignal.timeout(10_000),
  });

/** @param {any} entry @param {any} ctx */
function resolveMaxPages(entry, ctx) {
  const cap = (/** @type {unknown} */ v) => (Number.isInteger(v) && /** @type {number} */ (v) > 0 ? Math.min(/** @type {number} */ (v), MAX_PAGES_CAP) : null);
  return cap(ctx?.maxPages) ?? cap(entry?.max_pages) ?? DEFAULT_MAX_PAGES;
}

/** @param {number} ms @param {any} ctx */
const sleep = (ms, ctx) =>
  typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms));

/**
 * @param {any} ctx
 * @param {{tenant: string, site: string, culture: string}} board
 * @param {{token: string, cookie: string}} csrf
 * @param {number} start
 */
const searchPage = (ctx, board, csrf, start) =>
  ctx.fetchJson(searchUrl(board), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-csrf-token': csrf.token,
      cookie: csrf.cookie,
    },
    body: JSON.stringify({
      clientNamespace: board.tenant,
      jobBoardCode: board.site,
      cultureCode: board.culture,
      paginationStart: start,
    }),
    redirect: 'error',
  });

/** @type {Provider} */
export default {
  id: 'dayforce',

  detect(entry) {
    const board = parseDayforceUrl(entry?.careers_url);
    return board ? { url: searchUrl(board) } : null;
  },

  async fetch(entry, ctx) {
    const board = parseDayforceUrl(entry.careers_url);
    if (!board) throw new Error(`dayforce: cannot derive board for ${entry.name} — careers_url must be https://jobs.dayforcehcm.com/<tenant>/<site>`);
    const fetchResponse = /** @type {any} */ (ctx).fetchResponse ?? defaultFetchResponse;
    const maxPages = resolveMaxPages(entry, ctx);
    let csrf = await bootstrapCsrf(fetchResponse);

    /** @type {Array<import('./_types.js').Job>} */
    const jobs = [];
    let seen = 0;
    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleep(PAGE_DELAY_MS, ctx);
      /** @type {any} */
      let json;
      try {
        json = await searchPage(ctx, board, csrf, page * PAGE_SIZE);
      } catch (err) {
        // 403 is the one shape a stale/missing CSRF pair takes: re-mint once, first page only.
        if (page !== 0 || /** @type {any} */ (err)?.status !== 403) throw err;
        csrf = await bootstrapCsrf(fetchResponse);
        json = await searchPage(ctx, board, csrf, 0);
      }
      const rows = Array.isArray(json?.jobPostings) ? json.jobPostings : [];
      if (rows.length === 0) break;
      jobs.push(...parseDayforcePage(json, board, entry.name));
      seen += rows.length;
      const max = Number(json.maxCount);
      if (Number.isFinite(max) && seen >= max) break;
    }
    return jobs;
  },
};
