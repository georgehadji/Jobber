// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Oracle Taleo Enterprise provider — per-tenant careersection `searchjobs` REST
// endpoint (keyless JSON; one anonymous page GET yields the careersection's
// public `portalNo`, which the search POST needs).
// Provenance: github.com/strelov1/freehire internal/ingest/sources/taleo.go (MIT).
// Live-probed 2026-10-21 against valero.taleo.net/careersection/2 (HTTP 200,
// portalNo scraped, searchjobs returned requisitions with title/location/date).
// The probe showed the POST also works without the session cookie freehire
// carries, so no cookie jar is needed.
//
// Auto-detects from `https://<tenant>.taleo.net/careersection/<section>/...`.
// Taleo Business Edition (`tbe.taleo.net`, an RSS product) is a different
// platform and is deliberately NOT claimed. Tenant hosts vary, so SSRF defence
// is a regex on `<safe-tenant>.taleo.net` (same approach as bamboohr.mjs).
// The list carries no description (it needs a per-job detail page the
// zero-token scanner skips) so `description` is omitted.

const TALEO_HOST_RE = /^[a-z0-9][a-z0-9-]*\.taleo\.net$/;
const SECTION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PORTAL_RE = /portalNo:\s*'(\d+)'/;
// Path segments after /careersection/ that are API/static routes, not a section.
const RESERVED_SECTIONS = new Set(['rest', 'sitemap', 'theme', 'static']);
const DEFAULT_MAX_PAGES = 5;
const PAGE_DELAY_MS = 300;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/**
 * `{host, section}` from a Taleo careersection URL; null if not one.
 * @param {unknown} raw
 * @returns {{host: string, section: string} | null}
 */
export function parseTaleoUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !TALEO_HOST_RE.test(u.hostname) || u.hostname === 'tbe.taleo.net') return null;
  const m = /^\/careersection\/([^/]+)\//i.exec(u.pathname);
  const section = m?.[1] ?? '';
  if (!SECTION_RE.test(section) || RESERVED_SECTIONS.has(section.toLowerCase())) return null;
  return { host: u.hostname, section };
}

/** @param {string} url */
function assertTaleoUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`taleo: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:') throw new Error(`taleo: URL must use HTTPS: ${url}`);
  if (!TALEO_HOST_RE.test(u.hostname) || u.hostname === 'tbe.taleo.net') {
    throw new Error(`taleo: untrusted hostname "${u.hostname}" — must match <tenant>.taleo.net`);
  }
  return url;
}

/** @param {{host: string, section: string}} b */
const sectionUrl = b => assertTaleoUrl(`https://${b.host}/careersection/${encodeURIComponent(b.section)}/jobsearch.ftl?lang=en`);

/** @param {string} host @param {string} portal */
const searchUrl = (host, portal) => assertTaleoUrl(`https://${host}/careersection/rest/jobboard/searchjobs?lang=en&portal=${encodeURIComponent(portal)}`);

/** @param {number} page 1-based */
export function taleoSearchBody(page) {
  return {
    multilineEnabled: false,
    sortingSelection: { sortBySelectionParam: '3', ascendingSortingOrder: false },
    fieldData: {},
    filterSelectionParam: { searchFilterSelections: [] },
    advancedSearchFiltersSelectionParam: { searchFilterSelections: [] },
    pageNo: page,
  };
}

/** Location cells are JSON string arrays (`["US-TX-San Antonio"]`) or plain text. @param {string} cell */
function flattenLocation(cell) {
  try {
    const v = JSON.parse(cell);
    if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean).join(', ');
  } catch { /* plain text */ }
  return String(cell ?? '').trim();
}

/** "Oct 20, 2026" → epoch ms (UTC midnight); null when not that format. @param {string} cell */
export function parseTaleoDate(cell) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(String(cell ?? '').trim());
  if (!m || !(m[1] in MONTHS)) return null;
  return Date.UTC(Number(m[3]), MONTHS[/** @type {keyof typeof MONTHS} */ (m[1])], Number(m[2]));
}

/**
 * Normalize a `searchjobs` response. `column` is a per-tenant positional array:
 * column[0] is the title, location comes from the cells named by
 * `locationsColumns`, the date is the first cell parsing as "Mon D, YYYY".
 * Rows without contestNo or title are dropped (contestNo builds the URL).
 * Exported for unit tests.
 * @param {any} json
 * @param {string} companyName
 * @param {{host: string, section: string}} board
 * @returns {import('./_types.js').Job[]}
 */
export function parseTaleoResponse(json, companyName, board) {
  const rows = json?.requisitionList;
  if (!Array.isArray(rows)) return [];
  /** @type {import('./_types.js').Job[]} */
  const out = [];
  for (const r of rows) {
    const id = String(r?.contestNo ?? '').trim();
    const cols = Array.isArray(r?.column) ? r.column.map((/** @type {any} */ c) => String(c ?? '')) : [];
    const title = (cols[0] ?? '').trim();
    if (!id || !title) continue;
    const idxs = Array.isArray(r?.locationsColumns) ? r.locationsColumns : [];
    const location = idxs
      .filter((/** @type {any} */ i) => Number.isInteger(i) && i >= 0 && i < cols.length)
      .map((/** @type {number} */ i) => flattenLocation(cols[i]))
      .filter(Boolean)
      .join(', ');
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: `https://${board.host}/careersection/${encodeURIComponent(board.section)}/jobdetail.ftl?job=${encodeURIComponent(id)}&lang=en`,
      company: companyName,
      location,
    };
    for (const c of cols) {
      const t = parseTaleoDate(c);
      if (t !== null) {
        job.postedAt = t;
        break;
      }
    }
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'taleo',

  detect(entry) {
    const board = parseTaleoUrl(entry.careers_url);
    return board ? { url: sectionUrl(board) } : null;
  },

  async fetch(entry, ctx) {
    const board = parseTaleoUrl(entry.careers_url);
    if (!board) throw new Error(`taleo: cannot derive host/careersection for ${entry.name}`);
    const page0 = await ctx.fetchText(sectionUrl(board), { redirect: 'error' });
    const portal = PORTAL_RE.exec(String(page0))?.[1];
    if (!portal) throw new Error(`taleo: no portalNo on ${board.host}/${board.section} (not a public section?)`);
    const url = searchUrl(board.host, portal);
    const cap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : DEFAULT_MAX_PAGES;
    /** @type {import('./_types.js').Job[]} */
    const jobs = [];
    let seen = 0;
    for (let page = 1; page <= cap; page++) {
      const json = /** @type {any} */ (await ctx.fetchJson(url, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', tz: 'GMT+00:00', tzname: 'UTC' },
        body: JSON.stringify(taleoSearchBody(page)),
      }));
      const rows = Array.isArray(json?.requisitionList) ? json.requisitionList : [];
      if (rows.length === 0) break;
      jobs.push(...parseTaleoResponse(json, entry.name, board));
      seen += rows.length;
      const total = Number(json?.pagingData?.totalCount);
      if (total > 0 && seen >= total) break;
      if (page < cap && typeof ctx.sleep === 'function') await ctx.sleep(PAGE_DELAY_MS);
    }
    return jobs;
  },
};
