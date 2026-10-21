// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// JOIN (join.com) provider — public company jobs API.
// Provenance: ported from github.com/strelov1/freehire internal/ingest/sources/join.go (MIT).
// Live-probed 2026-10-21 on company "justhiringde" (id 167291):
//   GET https://join.com/companies/justhiringde                       -> 200 HTML embedding {"company":{"id":167291,...,"domain":"justhiringde"}}
//   GET https://join.com/api/public/companies/167291/jobs?page=1&pageSize=5 -> 200 JSON, no auth
// freehire keys boards by the numeric company id, which a careers URL does not carry; we
// resolve it with one request to the public company page. The list API caps pageSize at 5
// (422 above), so a board costs ceil(n/5) requests. The list carries no description (only the
// per-job detail does) so `description` is omitted to stay zero-token.
// Amounts are in minor units (6000000 EUR = "60.000 €" on the live page).

const JOIN_HOST_RE = /^(?:www\.)?join\.com$/;
const DOMAIN_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const ID_PARAM_RE = /^\d+(?:-[a-z0-9-]*)?$/i;
const PAGE_SIZE = 5;
const DEFAULT_MAX_PAGES = 10;
const PAGE_DELAY_MS = 300;

/** @param {import('./_types.js').PortalEntry} entry @returns {string | null} company domain slug */
function resolveDomain(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !JOIN_HOST_RE.test(u.hostname.toLowerCase())) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  return segs[0] === 'companies' && segs[1] && DOMAIN_RE.test(segs[1]) ? segs[1] : null;
}

/**
 * Pull the numeric company id out of the public company page. Exported for unit tests.
 * @param {string} html
 * @returns {{ id: number, domain: string } | null}
 */
export function parseCompanyPage(html) {
  const m = /"company":\{"id":(\d+),"name":"(?:[^"\\]|\\.)*","domain":"([A-Za-z0-9_-]+)"/.exec(String(html ?? ''));
  return m ? { id: Number(m[1]), domain: m[2] } : null;
}

/** @param {any} v @param {string} freq @returns {number | null} annualized major-unit amount */
function annualize(v, freq) {
  const minor = Number(v?.amount);
  if (!Number.isFinite(minor) || minor <= 0) return null;
  const mult = freq === 'PER_YEAR' ? 1 : freq === 'PER_MONTH' ? 12 : 0;
  return mult ? Math.round((minor / 100) * mult) : null;
}

/**
 * Normalize one list page. Exported for unit tests. Rows without a title or a well-formed
 * idParam are dropped (idParam is the URL / dedup key).
 * @param {any} json
 * @param {string} domain
 * @param {string} companyName
 */
export function parseJoinPage(json, domain, companyName) {
  const rows = Array.isArray(json?.items) ? json.items : [];
  const out = [];
  for (const j of rows) {
    const title = String(j?.title ?? '').trim();
    const idParam = String(j?.idParam ?? '').trim();
    if (!title || !ID_PARAM_RE.test(idParam)) continue;
    const place = [j.city?.cityName, j.country?.name ?? j.city?.countryName].filter(Boolean);
    if (j.workplaceType === 'REMOTE') place.push('Remote');
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: `https://join.com/companies/${domain}/${idParam}`,
      company: companyName,
      location: place.join(', '),
    };
    const ts = Date.parse(j.createdAt);
    if (Number.isFinite(ts)) job.postedAt = ts;
    const min = annualize(j.salaryAmountFrom, j.salaryFrequency);
    const max = annualize(j.salaryAmountTo, j.salaryFrequency);
    if ((min !== null || max !== null) && j.settings?.showSalary !== false) {
      job.salary = {
        min,
        max,
        currency: String(j.salaryAmountFrom?.currency ?? j.salaryAmountTo?.currency ?? ''),
      };
    }
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'join',

  detect(entry) {
    const d = resolveDomain(entry);
    return d ? { url: `https://join.com/companies/${d}` } : null;
  },

  async fetch(entry, ctx) {
    const domain = resolveDomain(entry);
    if (!domain) throw new Error(`join: cannot derive company domain for ${entry.name}`);
    const html = await ctx.fetchText(`https://join.com/companies/${domain}`, { redirect: 'error' });
    const company = parseCompanyPage(html);
    if (!company || company.domain.toLowerCase() !== domain.toLowerCase()) {
      throw new Error(`join: company id not found on page for "${domain}"`);
    }
    const maxPages = ctx.maxPages && ctx.maxPages > 0 ? ctx.maxPages : Math.min(Number(entry.max_pages) || DEFAULT_MAX_PAGES, 100);
    const sleep = ctx.sleep ?? ((/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms)));
    /** @type {import('./_types.js').Job[]} */
    const jobs = [];
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(PAGE_DELAY_MS);
      const json = /** @type {any} */ (
        await ctx.fetchJson(`https://join.com/api/public/companies/${company.id}/jobs?page=${page}&pageSize=${PAGE_SIZE}`, { redirect: 'error' })
      );
      jobs.push(...parseJoinPage(json, company.domain, entry.name));
      const pageCount = Number(json?.pagination?.pageCount) || 0;
      if (page >= pageCount) break;
    }
    return jobs;
  },
};
