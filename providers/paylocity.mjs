// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Paylocity Recruiting provider — keyless server-rendered listing page.
// Provenance: ported from github.com/strelov1/freehire
// internal/ingest/sources/paylocity.go (MIT). Live-probed 2026-10-21 against
// https://recruiting.paylocity.com/Recruiting/Jobs/All/1a06dc72-45ee-4c90-a268-fe881bbeb577
// (2 postings, 200, no auth).
//
// Auto-detects from careers_url
// `https://recruiting.paylocity.com/Recruiting/Jobs/All/<company-guid>`.
// The listing is ONE GET (no pagination): the HTML embeds a `window.pageData`
// blob whose `"Jobs":[...]` array holds every open posting (JobId, JobTitle,
// LocationName, JobLocation{City,State,Country}, PublishedDate, IsRemote).
// Its `Description` is truncated to ~100 chars and the full body needs a
// per-job detail request, so `description` is omitted. No salary in the list.

const PAYLOCITY_HOST = 'recruiting.paylocity.com';
const GUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * Extract the company GUID from a Paylocity listing/board URL, or null.
 * Only `/Recruiting/Jobs/All/<guid>` names a board — a posting URL
 * (`/Jobs/Details/<id>`) carries a posting id and nothing else.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function parsePaylocityBoardUrl(raw) {
  if (typeof raw !== 'string') return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== PAYLOCITY_HOST || u.port || u.username || u.password) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 4) return null;
  if (segs[0].toLowerCase() !== 'recruiting' || segs[1].toLowerCase() !== 'jobs' || segs[2].toLowerCase() !== 'all') return null;
  return GUID_RE.test(segs[3]) ? segs[3].toLowerCase() : null;
}

/** @param {string} guid */
const listingUrl = (guid) => `https://${PAYLOCITY_HOST}/Recruiting/Jobs/All/${guid}`;

/**
 * Slice the balanced `"Jobs":[ ... ]` array out of the page and JSON-decode
 * it. String- and escape-aware so brackets inside titles do not unbalance it.
 * Returns null when there is no Jobs array or it does not decode.
 * Exported for unit tests.
 * @param {string} html
 * @returns {any[] | null}
 */
export function extractPaylocityJobs(html) {
  if (typeof html !== 'string') return null;
  const key = html.indexOf('"Jobs":');
  if (key < 0) return null;
  const start = html.indexOf('[', key);
  // The '[' must follow the key directly (modulo whitespace), not a later array.
  if (start < 0 || html.slice(key + 7, start).trim() !== '') return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) {
      try {
        const arr = JSON.parse(html.slice(start, i + 1));
        return Array.isArray(arr) ? arr : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Normalize the embedded Jobs array. Exported for unit tests. Rows without a
 * positive JobId or a title are dropped (the detail URL is the dedup key).
 * @param {any[] | null} rows
 * @param {string} companyName
 * @returns {Array<import('./_types.js').Job>}
 */
export function parsePaylocityJobs(rows, companyName) {
  if (!Array.isArray(rows)) return [];
  /** @type {Array<import('./_types.js').Job>} */
  const out = [];
  for (const r of rows) {
    const id = Number(r?.JobId);
    const title = typeof r?.JobTitle === 'string' ? r.JobTitle.trim() : '';
    if (!Number.isInteger(id) || id <= 0 || !title) continue;
    const jl = r.JobLocation && typeof r.JobLocation === 'object' ? r.JobLocation : {};
    const place = [jl.City, jl.State].filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).join(', ');
    let location = place || (typeof r.LocationName === 'string' ? r.LocationName.trim() : '');
    if (r.IsRemote === true && !/remote/i.test(location)) location = location ? `${location}, Remote` : 'Remote';
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: `https://${PAYLOCITY_HOST}/Recruiting/Jobs/Details/${id}`,
      company: companyName,
      location,
    };
    const t = typeof r.PublishedDate === 'string' ? Date.parse(r.PublishedDate) : NaN;
    if (Number.isFinite(t)) job.postedAt = t;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'paylocity',

  detect(entry) {
    const guid = parsePaylocityBoardUrl(entry?.careers_url);
    return guid ? { url: listingUrl(guid) } : null;
  },

  async fetch(entry, ctx) {
    const guid = parsePaylocityBoardUrl(entry.careers_url);
    if (!guid) throw new Error(`paylocity: cannot derive board for ${entry.name} — careers_url must be https://recruiting.paylocity.com/Recruiting/Jobs/All/<guid>`);
    // redirect:'error' + the exact-host check above pin the request to Paylocity (SSRF).
    const html = await ctx.fetchText(listingUrl(guid), { redirect: 'error', headers: { accept: 'text/html' } });
    const rows = extractPaylocityJobs(html);
    if (rows === null) throw new Error(`paylocity: no Jobs array in listing for ${entry.name}`);
    return parsePaylocityJobs(rows, entry.name);
  },
};
