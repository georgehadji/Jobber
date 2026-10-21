// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Paycom ATS provider — public career portals at
// `https://www.paycomonline.net/v4/ats/web.php/portal/<clientkey>/...`.
// Ported from github.com/strelov1/freehire internal/ingest/sources/paycom.go (MIT).
// Live-probed 2026-10-21 against client key e743deb45c5896f708643c7d7b581397
// (SEGA of America): 200s, no account, no browser.
//
// The portal's SSR shell embeds a per-portal session JWT (`"sessionJWT":"…"`) and the
// regional "Mantle" API host. Both are read from the public page in the same run
// (no stored credential); the JWT is then the Authorization header for:
//   POST https://portal-applicant-tracking.<region>.paycomonline.net/api/ats/job-posting-previews/search
//        body { skip, take, filtersForQuery:{…} }  (filters MUST nest under filtersForQuery)
//   → { jobPostingPreviewsCount, jobPostingPreviews: [{ jobId, jobTitle, locations,
//       remoteType, positionType, description (truncated snippet), postedOn }] }
// freehire then fetches one detail request per posting for the full description; Jobber
// stays list-only, so the truncated snippet is NOT exposed as `description`.

const PORTAL_BASE = 'https://www.paycomonline.net/v4/ats/web.php/portal';
const CLIENT_KEY_RE = /^[0-9a-f]{32}$/;
const MANTLE_RE = /portal-applicant-tracking\.[a-z0-9-]+\.paycomonline\.net/;
const MANTLE_HOST_RE = /^portal-applicant-tracking\.[a-z0-9-]+\.paycomonline\.net$/;
const NO_SUCH_BOARD = 'Job board does not exist.';
const PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 5;
const PAGE_DELAY_MS = 150;

/**
 * 32-hex client key (lowercased; the platform serves either case) from a
 * paycomonline.net URL: `/portal/<key>/…` or a `clientkey=<key>` parameter.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveClientKey(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.hostname !== 'paycomonline.net' && !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.paycomonline\.net$/.test(u.hostname)) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  const i = segs.indexOf('portal');
  const fromPath = i >= 0 ? (segs[i + 1] ?? '').toLowerCase() : '';
  if (CLIENT_KEY_RE.test(fromPath)) return fromPath;
  const fromQuery = (u.searchParams.get('clientkey') ?? '').toLowerCase();
  return CLIENT_KEY_RE.test(fromQuery) ? fromQuery : null;
}

/**
 * Read the session JWT and Mantle API origin out of the portal shell.
 * Exported for unit tests. The Mantle host is validated against a strict regex so
 * a hostile page cannot steer the authenticated requests off paycomonline.net.
 * @param {string} page
 * @returns {{jwt: string, mantle: string} | null}
 */
export function extractPortalSession(page) {
  if (typeof page !== 'string') return null;
  const jwt = page.match(/"sessionJWT":"([^"]+)"/)?.[1] ?? '';
  const host = page.match(MANTLE_RE)?.[0] ?? '';
  if (!jwt || !MANTLE_HOST_RE.test(host)) return null;
  return { jwt, mantle: `https://${host}` };
}

/** Request body for the previews search. @param {number} skip @param {number} take */
export function buildSearchBody(skip, take) {
  return {
    skip,
    take,
    filtersForQuery: {
      distanceFrom: 0,
      workEnvironments: [],
      positionTypes: [],
      educationLevels: [],
      categories: [],
      travelTypes: [],
      shiftTypes: [],
      otherFilters: [],
      keywordSearchText: '',
      location: '',
      sortOption: '',
    },
  };
}

/**
 * Parse one previews-search page into Jobs. Exported for unit tests.
 * Rows without a numeric jobId or a title are dropped. postedOn is used only when
 * it parses as a date (it is blank on the board probed).
 *
 * @param {any} json
 * @param {string} clientKey
 * @param {string} companyName
 * @returns {import('./_types.js').Job[]}
 */
export function parsePreviews(json, clientKey, companyName) {
  const rows = json?.jobPostingPreviews;
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const p of rows) {
    const id = String(p?.jobId ?? '').trim();
    const title = String(p?.jobTitle ?? '').trim();
    if (!/^\d+$/.test(id) || !title) continue;
    let location = String(p.locations ?? '').trim();
    if (String(p.remoteType ?? '').toLowerCase() === 'remote' && !/remote/i.test(location)) {
      location = location ? `${location} (Remote)` : 'Remote';
    }
    /** @type {import('./_types.js').Job} */
    const job = { title, url: `${PORTAL_BASE}/${clientKey}/jobs/${id}`, company: companyName, location };
    const posted = p.postedOn ? Date.parse(String(p.postedOn)) : NaN;
    if (Number.isFinite(posted)) job.postedAt = posted;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'paycom',

  detect(entry) {
    const key = resolveClientKey(entry);
    return key ? { url: `${PORTAL_BASE}/${key}/jobs/1` } : null;
  },

  async fetch(entry, ctx) {
    const key = resolveClientKey(entry);
    if (!key) throw new Error(`paycom: cannot derive 32-hex client key from careers_url for ${entry.name}`);
    // redirect:'error' on every request: neither the portal nor the API may bounce us off-domain.
    const page = await ctx.fetchText(`${PORTAL_BASE}/${key}/jobs/1`, { redirect: 'error' });
    if (typeof page === 'string' && page.includes(NO_SUCH_BOARD)) {
      throw new Error(`paycom: board ${key} does not exist (retired client key)`);
    }
    const session = extractPortalSession(page);
    if (!session) throw new Error(`paycom: no session token / API host in portal page for ${entry.name}`);

    const wait = (/** @type {number} */ ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const maxPages = Number.isInteger(ctx.maxPages) && /** @type {number} */ (ctx.maxPages) > 0 ? /** @type {number} */ (ctx.maxPages) : DEFAULT_MAX_PAGES;
    const jobs = [];
    const seen = new Set();
    for (let pageNo = 0; pageNo < maxPages; pageNo++) {
      if (pageNo > 0) await wait(PAGE_DELAY_MS);
      const json = /** @type {any} */ (await ctx.fetchJson(`${session.mantle}/api/ats/job-posting-previews/search`, {
        method: 'POST',
        headers: { Authorization: session.jwt, Locale: 'en-US', 'content-type': 'application/json' },
        body: JSON.stringify(buildSearchBody(pageNo * PAGE_SIZE, PAGE_SIZE)),
        redirect: 'error',
      }));
      const rows = parsePreviews(json, key, entry.name);
      let fresh = 0;
      for (const job of rows) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
        fresh++;
      }
      const total = Number(json?.jobPostingPreviewsCount);
      if (fresh === 0 || (Number.isFinite(total) && jobs.length >= total)) break;
    }
    return jobs;
  },
};
