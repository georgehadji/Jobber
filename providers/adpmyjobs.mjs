// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// ADP MyJobs provider — myjobs.adp.com career sites (keyless JSON).
// Provenance: github.com/strelov1/freehire internal/ingest/sources/adpmyjobs.go (MIT).
// Live-probed 2026-10-21 against the `stellantisexternalcx` career site
// (HTTP 200, 877 requisitions).
//
// A different ADP product from Workforce Now (see adp.mjs): the board is a
// career-site slug. The site's public record (myjobs.adp.com/public/staffing/
// v1/career-site/<slug>) publishes an `orgoid`, which authorises the listing at
// my.adp.com via an `orgoid` request header. Both hosts are fixed, so SSRF
// defence is an exact-host check plus a strict slug charset. The list payload
// carries no description or posting date (both need a per-job detail request
// the zero-token scanner skips), so only title/url/location are populated.

const SITE_HOST = 'myjobs.adp.com';
const LIST_HOST = 'my.adp.com';
const LIST_URL = `https://${LIST_HOST}/myadp_prefix/mycareer/public/staffing/v1/job-requisitions`;
const PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 5;
const PAGE_DELAY_MS = 300;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const ORGOID_RE = /^[A-Za-z0-9]{4,64}$/;
// First path segments on myjobs.adp.com that are product routes, not tenants.
const RESERVED_SLUGS = new Set(['public', 'api', 'static', 'assets']);

/**
 * Career-site slug from a myjobs.adp.com URL; null if not one.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function parseAdpMyJobsSlug(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== SITE_HOST) return null;
  const slug = u.pathname.split('/').filter(Boolean)[0] ?? '';
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug.toLowerCase())) return null;
  return slug.toLowerCase();
}

/** @param {string} url */
function assertAdpUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`adpmyjobs: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:') throw new Error(`adpmyjobs: URL must use HTTPS: ${url}`);
  if (u.hostname !== SITE_HOST && u.hostname !== LIST_HOST) {
    throw new Error(`adpmyjobs: untrusted hostname "${u.hostname}" — must be ${SITE_HOST} or ${LIST_HOST}`);
  }
  return url;
}

/** @param {string} slug */
const siteUrl = slug => assertAdpUrl(`https://${SITE_HOST}/public/staffing/v1/career-site/${encodeURIComponent(slug)}`);

/**
 * "City, Region, Country" from the first requisition location; parts the
 * platform left empty are dropped. Exported for unit tests.
 * @param {any} r
 */
export function adpMyJobsLocation(r) {
  const a = r?.requisitionLocations?.[0]?.address;
  if (!a) return '';
  return [a.cityName, a.countrySubdivisionLevel1?.longName, a.country?.longName]
    .map(p => String(p ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Normalize a MyJobs list payload. Rows without reqId or jobTitle are dropped
 * (reqId is the URL / dedup key). Exported for unit tests.
 * @param {any} json
 * @param {string} companyName
 * @param {string} slug
 * @returns {import('./_types.js').Job[]}
 */
export function parseAdpMyJobsResponse(json, companyName, slug) {
  const rows = json?.jobRequisitions;
  if (!Array.isArray(rows)) return [];
  /** @type {import('./_types.js').Job[]} */
  const out = [];
  for (const r of rows) {
    const id = String(r?.reqId ?? '').trim();
    const title = String(r?.jobTitle ?? '').trim();
    if (!id || !title) continue;
    out.push({
      title,
      url: `https://${SITE_HOST}/${encodeURIComponent(slug)}/cx/job/${encodeURIComponent(id)}`,
      company: companyName,
      location: adpMyJobsLocation(r),
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'adpmyjobs',

  detect(entry) {
    const slug = parseAdpMyJobsSlug(entry.careers_url);
    return slug ? { url: siteUrl(slug) } : null;
  },

  async fetch(entry, ctx) {
    const slug = parseAdpMyJobsSlug(entry.careers_url);
    if (!slug) throw new Error(`adpmyjobs: cannot derive career-site slug for ${entry.name}`);
    const site = /** @type {any} */ (await ctx.fetchJson(siteUrl(slug), { redirect: 'error' }));
    const orgoid = String(site?.orgoid ?? '');
    // Node's default `Accept-Language: *` makes the listing return count 0, hence the explicit en-US below.
    // Without an orgoid the listing 400s, which would read as a dead board.
    if (!ORGOID_RE.test(orgoid)) throw new Error(`adpmyjobs: career site ${slug} published no usable orgoid`);
    const company = entry.name || String(site?.clientName ?? site?.name ?? '').trim();
    const cap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : DEFAULT_MAX_PAGES;
    /** @type {import('./_types.js').Job[]} */
    const jobs = [];
    for (let page = 0; page < cap; page++) {
      const skip = page * PAGE_SIZE;
      const url = assertAdpUrl(`${LIST_URL}?%24top=${PAGE_SIZE}&%24skip=${skip}`);
      const json = /** @type {any} */ (await ctx.fetchJson(url, { redirect: 'error', headers: { orgoid, 'accept-language': 'en-US' } }));
      const rows = Array.isArray(json?.jobRequisitions) ? json.jobRequisitions : [];
      if (rows.length === 0) break;
      jobs.push(...parseAdpMyJobsResponse(json, company, slug));
      const count = Number(json?.count);
      if (Number.isFinite(count) && skip + rows.length >= count) break;
      if (page + 1 < cap && typeof ctx.sleep === 'function') await ctx.sleep(PAGE_DELAY_MS);
    }
    return jobs;
  },
};
