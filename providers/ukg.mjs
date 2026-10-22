// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// UKG Pro Recruiting (formerly UltiPro) provider — keyless POST JSON listing API.
// Provenance: ported from github.com/strelov1/freehire
// internal/ingest/sources/ukg.go (MIT). Live-probed 2026-10-21 against
// https://recruiting.ultipro.com/van5000vcscu/JobBoard/a46cbdaa-ca2c-49b6-8d2b-e0ceaafa0e25
// (53 postings, 200, no auth).
//
// Auto-detects from careers_url `https://<host>/<tenant>/JobBoard/<guid>[/...]`
// where <host> is a UKG recruiting host (`*.ultipro.com`, `*.ultipro.ca`,
// `*.rec.pro.ukg.net`; the TLD carries data residency). The listing is
//   POST /<tenant>/JobBoard/<guid>/JobBoardView/LoadSearchResults
//   { opportunitySearch: { Top, Skip } }  ->  { opportunities[], totalCount }
// It carries only a BriefDescription (a teaser); the full body needs a per-job
// detail-page request, which the zero-token scanner skips, so `description` is
// omitted (a teaser could wrongly fail content_filter). No salary in the list.

const UKG_HOST_RE = /^(?:[a-z0-9][a-z0-9-]*\.)+(?:ultipro\.com|ultipro\.ca|rec\.pro\.ukg\.net)$/;
const TENANT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PAGE_SIZE = 100; // verified live: Top up to 500 honoured
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_CAP = 100;
const PAGE_DELAY_MS = 300;

/**
 * Parse a UKG careers URL into its board coordinates, or null when it is not
 * an https UKG `<host>/<tenant>/JobBoard/<guid>` URL on an allowed host.
 * @param {unknown} raw
 * @returns {{host: string, tenant: string, guid: string} | null}
 */
export function parseUkgBoardUrl(raw) {
  if (typeof raw !== 'string') return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  if (!UKG_HOST_RE.test(u.hostname)) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 3 || segs[1].toLowerCase() !== 'jobboard') return null;
  const [tenant, , guid] = segs;
  if (!TENANT_RE.test(tenant) || !GUID_RE.test(guid)) return null;
  return { host: u.hostname, tenant, guid };
}

/** @param {{host: string, tenant: string, guid: string}} b */
const searchUrl = (b) =>
  `https://${b.host}/${b.tenant}/JobBoard/${b.guid}/JobBoardView/LoadSearchResults`;

/** @param {{host: string, tenant: string, guid: string}} b @param {string} id */
const detailUrl = (b, id) =>
  `https://${b.host}/${b.tenant}/JobBoard/${b.guid}/OpportunityDetail?opportunityId=${encodeURIComponent(id)}`;

/**
 * Render the first location as "City, State, Country", falling back to its
 * localized label when there is no structured address.
 * @param {any} o
 */
export function ukgLocation(o) {
  const loc = Array.isArray(o?.Locations) ? o.Locations[0] : null;
  if (!loc || typeof loc !== 'object') return '';
  const a = loc.Address;
  const structured = a && typeof a === 'object'
    ? [a.City, a.State?.Name, a.Country?.Name].filter((s) => typeof s === 'string' && s.trim()).join(', ')
    : '';
  return structured || (typeof loc.LocalizedName === 'string' ? loc.LocalizedName.trim() : '');
}

/**
 * Normalize one LoadSearchResults page. Exported for unit tests. Rows without
 * a non-empty Id or Title are dropped (the detail URL is the dedup key).
 * @param {any} json
 * @param {{host: string, tenant: string, guid: string}} board
 * @param {string} companyName
 * @returns {Array<import('./_types.js').Job>}
 */
export function parseUkgPage(json, board, companyName) {
  const rows = json?.opportunities;
  if (!Array.isArray(rows)) return [];
  /** @type {Array<import('./_types.js').Job>} */
  const out = [];
  for (const o of rows) {
    const id = typeof o?.Id === 'string' ? o.Id.trim() : '';
    const title = typeof o?.Title === 'string' ? o.Title.trim() : '';
    if (!id || !title) continue;
    /** @type {import('./_types.js').Job} */
    const job = { title, url: detailUrl(board, id), company: companyName, location: ukgLocation(o) };
    const t = typeof o.PostedDate === 'string' ? Date.parse(o.PostedDate) : NaN;
    if (Number.isFinite(t)) job.postedAt = t;
    out.push(job);
  }
  return out;
}

/** @param {any} entry @param {any} ctx */
function resolveMaxPages(entry, ctx) {
  const cap = (/** @type {unknown} */ v) => (Number.isInteger(v) && /** @type {number} */ (v) > 0 ? Math.min(/** @type {number} */ (v), MAX_PAGES_CAP) : null);
  return cap(ctx?.maxPages) ?? cap(entry?.max_pages) ?? DEFAULT_MAX_PAGES;
}

/** @param {number} ms @param {any} ctx */
const sleep = (ms, ctx) =>
  typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms));

/** @type {Provider} */
export default {
  id: 'ukg',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const board = parseUkgBoardUrl(entry?.careers_url);
    return board ? { url: searchUrl(board) } : null;
  },

  async fetch(entry, ctx) {
    const board = parseUkgBoardUrl(entry.careers_url);
    if (!board) throw new Error(`ukg: cannot derive board for ${entry.name} — careers_url must be https://<host>.ultipro.com/<tenant>/JobBoard/<guid>`);
    const url = searchUrl(board);
    const maxPages = resolveMaxPages(entry, ctx);
    /** @type {Array<import('./_types.js').Job>} */
    const jobs = [];
    let skip = 0;
    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleep(PAGE_DELAY_MS, ctx);
      // redirect:'error' + the host check above pin every hop to the UKG host (SSRF).
      const json = /** @type {any} */ (await ctx.fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ opportunitySearch: { Top: PAGE_SIZE, Skip: skip } }),
        redirect: 'error',
      }));
      const rows = Array.isArray(json?.opportunities) ? json.opportunities : [];
      if (rows.length === 0) break;
      jobs.push(...parseUkgPage(json, board, entry.name));
      skip += rows.length;
      const total = Number(json.totalCount);
      if (Number.isFinite(total) && skip >= total) break;
    }
    return jobs;
  },
};
