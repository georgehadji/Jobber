// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// iSolved Hire provider — public per-tenant career site `https://<tenant>.isolvedhire.com/jobs/`.
// Ported from github.com/strelov1/freehire internal/ingest/sources/isolvedhire.go (MIT);
// freehire walks sitemap.xml + one ld+json detail page per posting, whereas this
// provider uses the JSON endpoint the site's own Vue listing component calls, which
// returns the whole board (title, location, pay, start date) in ONE request.
// Live-probed 2026-10-21 against https://saratech.isolvedhire.com (also isolved,
// lehighcounty, imagine360): no auth, no browser.
//
//   1. GET https://<tenant>.isolvedhire.com/jobs/            → HTML embeds `domainId : <n>`
//   2. GET https://<tenant>.isolvedhire.com/core/jobs/<n>?getParams=%7B%7D
//      → { success, data: { jobCount, jobs: [{ id, title, jobLocation, city, abbreviation,
//          workplaceType, startDateRef:"Jun 04, 2026", minSalary:"90,000", maxSalary:"130,000",
//          payTypeFrame:"per year", iso3:"USA", jobUrl }] } }
// (A bare /core/jobs/<n> without getParams answers a PHP error page.) No pagination:
// jobCount equals jobs.length. The list carries no description.

const ISOLVED_HOST_RE = /^[a-z0-9][a-z0-9-]*\.isolvedhire\.com$/;

// Pay-frame → annualization multiplier. Frames not listed (daily, bi-weekly, …) are
// ambiguous about the working calendar, so salary is omitted rather than guessed.
const FRAME_MULTIPLIERS = { 'per hour': 2080, 'per week': 52, 'per month': 12, 'per year': 1 };

/**
 * Tenant origin from entry.api / entry.careers_url, or null if not an iSolved Hire host.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveOrigin(entry) {
  const raw = String((typeof entry?.api === 'string' && entry.api) || (typeof entry?.careers_url === 'string' && entry.careers_url) || '').trim();
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !ISOLVED_HOST_RE.test(u.hostname)) return null;
  return `https://${u.hostname}`;
}

/** Numeric domain id embedded in the /jobs/ page, or null. @param {string} html */
export function extractDomainId(html) {
  const m = typeof html === 'string' ? html.match(/\bdomainId\s*:\s*(\d{1,12})\b/) : null;
  return m ? m[1] : null;
}

/** "65,000.00" → 65000; ""/junk → null. @param {any} v */
function parseAmount(v) {
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Annualized salary or null. Unknown frame or no amounts → null (field omitted).
 * @param {any} j
 * @returns {{min: number|null, max: number|null, currency: string} | null}
 */
export function parseSalary(j) {
  const mult = /** @type {Record<string, number>} */ (FRAME_MULTIPLIERS)[String(j?.payTypeFrame ?? '').trim().toLowerCase()];
  if (!mult) return null;
  const lo = parseAmount(j.minSalary);
  const hi = parseAmount(j.maxSalary);
  if (lo === null && hi === null) return null;
  // iso3 is the only currency signal; the platform is US-based, so only USA is mapped.
  const currency = String(j.iso3 ?? '').toUpperCase() === 'USA' ? 'USD' : '';
  return {
    min: lo === null ? null : Math.round(lo * mult),
    max: hi === null ? null : Math.round(hi * mult),
    currency,
  };
}

/**
 * Parse the /core/jobs/<domainId> response. Exported for unit tests.
 * Rows without a numeric id or a title are dropped; a `jobUrl` off the tenant host
 * is replaced by `<origin>/jobs/<id>`.
 *
 * @param {any} json
 * @param {string} origin e.g. "https://acme.isolvedhire.com"
 * @param {string} companyName
 * @returns {import('./_types.js').Job[]}
 */
export function parseIsolvedResponse(json, origin, companyName) {
  const rows = json?.data?.jobs;
  if (!Array.isArray(rows)) return [];
  const host = new URL(origin).hostname;
  const out = [];
  const seen = new Set();
  for (const j of rows) {
    const id = String(j?.id ?? '').trim();
    const title = String(j?.title ?? '').trim();
    if (!/^\d+$/.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    let url = `${origin}/jobs/${id}`;
    try {
      const u = new URL(String(j.jobUrl ?? ''));
      if (u.protocol === 'https:' && u.hostname === host) url = u.href;
    } catch { /* keep canonical url */ }
    let location = String(j.jobLocation ?? '').trim()
      || [j.city, j.abbreviation].map((p) => String(p ?? '').trim()).filter(Boolean).join(', ');
    if (/fully remote/i.test(String(j.workplaceType ?? '')) && !/remote/i.test(location)) {
      location = location ? `${location} (Remote)` : 'Remote';
    }
    /** @type {import('./_types.js').Job} */
    const job = { title, url, company: companyName, location };
    const posted = Date.parse(`${String(j.startDateRef ?? '').trim()} UTC`);
    if (Number.isFinite(posted)) job.postedAt = posted;
    const salary = parseSalary(j);
    if (salary) job.salary = salary;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'isolvedhire',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}/jobs/` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`isolvedhire: cannot derive <tenant>.isolvedhire.com URL for ${entry.name}`);
    // redirect:'error' keeps the final host pinned to the validated tenant (SSRF).
    const page = await ctx.fetchText(`${origin}/jobs/`, { redirect: 'error' });
    const domainId = extractDomainId(page);
    if (!domainId) throw new Error(`isolvedhire: no domainId in ${origin}/jobs/ for ${entry.name}`);
    const json = await ctx.fetchJson(`${origin}/core/jobs/${domainId}?getParams=%7B%7D`, { redirect: 'error' });
    return parseIsolvedResponse(json, origin, entry.name);
  },
};
