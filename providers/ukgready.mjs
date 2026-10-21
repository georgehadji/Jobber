// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// UKG Ready (formerly Kronos Workforce Ready / SaaSHR) provider — keyless
// REST JSON used by the career-page SPA. NOT the same product as `ukg`
// (UKG Pro Recruiting / UltiPro). Provenance: ported from
// github.com/strelov1/freehire internal/ingest/sources/ukgready.go (MIT).
// Live-probed 2026-10-21 against https://secure4.saashr.com/ta/6162397.careers
// (21 postings) and https://secure.entertimeonline.com/ta/10284.careers
// (15 postings, hourly pay) — 200, no auth.
//
// Auto-detects from careers_url `https://<host>/ta/<tenant>.careers[...]` on a
// UKG Ready white-label host (saashr.com, entertimeonline.com,
// yourpayrollhr.com, mykronos.com, workforceready.com.au, workforceready.eu).
// The host selects the hosting environment and is NOT derivable from the
// tenant, so it is kept. Listing:
//   GET /ta/rest/ui/recruitment/companies/%7C<tenant>/job-requisitions?offset=<page>&size=200
// NOTE `offset` is a 1-based PAGE NUMBER, not a row offset. The list carries
// only a ~250-char ellipsised job_description preview (full body needs a
// per-job request), so `description` is omitted. Pay figures are bare numbers;
// the currency comes from one extra tenant `format-settings` GET, made only
// when some posting states pay. Amounts are annualized (HOUR x2080, WEEK x52,
// MONTH x12); an unknown period or currency drops the salary.

const UKGREADY_HOST_RE = /^(?:[a-z0-9][a-z0-9-]*\.)+(?:saashr\.com|entertimeonline\.com|yourpayrollhr\.com|mykronos\.com|workforceready\.com\.au|workforceready\.eu)$/;
const TENANT_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PAGE_SIZE = 200; // API maximum; 250 is refused
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_CAP = 100;
const PAGE_DELAY_MS = 300;

/** @type {Record<string, number>} */
const PERIOD_MULTIPLIER = { YEAR: 1, MONTH: 12, WEEK: 52, HOUR: 2080 };

/**
 * Parse a UKG Ready career-page URL into {host, tenant}, or null.
 * @param {unknown} raw
 * @returns {{host: string, tenant: string} | null}
 */
export function parseUkgReadyUrl(raw) {
  if (typeof raw !== 'string') return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  if (!UKGREADY_HOST_RE.test(u.hostname)) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 2 || segs[0].toLowerCase() !== 'ta') return null;
  const m = /^(.+)\.careers$/i.exec(segs[1]);
  if (!m || !TENANT_RE.test(m[1])) return null;
  return { host: u.hostname, tenant: m[1].toLowerCase() };
}

/** @param {{host: string, tenant: string}} b */
const requisitionsUrl = (b) =>
  `https://${b.host}/ta/rest/ui/recruitment/companies/%7C${b.tenant}/job-requisitions`;
/** @param {{host: string, tenant: string}} b */
const settingsUrl = (b) =>
  `https://${b.host}/ta/rest/ui/bootstrap/companies/%7C${b.tenant}/format-settings`;
/** @param {{host: string, tenant: string}} b @param {string} id */
const jobUrl = (b, id) => `https://${b.host}/ta/${b.tenant}.careers?ShowJob=${encodeURIComponent(id)}`;

/** @param {unknown} v */
const posNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * Annualized salary for a posting, or undefined when the amount, period or
 * currency is missing/unknown (a half-qualified amount is never published).
 * Exported for unit tests.
 * @param {any} p
 * @param {string} currency
 * @returns {import('./_types.js').Job['salary']}
 */
export function ukgReadySalary(p, currency) {
  const mult = PERIOD_MULTIPLIER[String(p?.base_pay_frequency ?? '').trim().toUpperCase()];
  if (!mult || !/^[A-Za-z]{3}$/.test(currency)) return undefined;
  const from = posNum(p.base_pay_from);
  const to = posNum(p.base_pay_to);
  if (from === null && to === null) return undefined;
  return {
    min: from === null ? null : Math.round(from * mult),
    max: to === null ? null : Math.round(to * mult),
    currency: currency.toUpperCase(),
  };
}

/** True when a posting states a pay figure with a known period. @param {any} p */
const statesPay = (p) =>
  Boolean(PERIOD_MULTIPLIER[String(p?.base_pay_frequency ?? '').trim().toUpperCase()]) &&
  (posNum(p?.base_pay_from) !== null || posNum(p?.base_pay_to) !== null);

/**
 * Normalize job_requisitions rows. Exported for unit tests. Rows without a
 * usable id or title are dropped.
 * @param {any[]} rows
 * @param {{host: string, tenant: string}} board
 * @param {string} companyName
 * @param {string} [currency]
 * @returns {Array<import('./_types.js').Job>}
 */
export function parseUkgReadyRows(rows, board, companyName, currency = '') {
  /** @type {Array<import('./_types.js').Job>} */
  const out = [];
  for (const p of rows) {
    const id = String(p?.id ?? '').trim();
    const title = typeof p?.job_title === 'string' ? p.job_title.trim() : '';
    if (!/^[1-9]\d*$/.test(id) || !title) continue; // ids are positive integers; 0/blank would collide as a dedup key
    const l = p.location && typeof p.location === 'object' ? p.location : {};
    const parts = [l.city, l.state, l.country].filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());
    if (p.is_remote_job === true && !parts.some((s) => /remote/i.test(s))) parts.push('Remote');
    /** @type {import('./_types.js').Job} */
    const job = { title, url: jobUrl(board, id), company: companyName, location: parts.join(', ') };
    const salary = ukgReadySalary(p, currency);
    if (salary) job.salary = salary;
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
  id: 'ukgready',

  detect(entry) {
    const board = parseUkgReadyUrl(entry?.careers_url);
    return board ? { url: requisitionsUrl(board) } : null;
  },

  async fetch(entry, ctx) {
    const board = parseUkgReadyUrl(entry.careers_url);
    if (!board) throw new Error(`ukgready: cannot derive board for ${entry.name} — careers_url must be https://<host>.saashr.com/ta/<tenant>.careers`);
    const maxPages = resolveMaxPages(entry, ctx);
    /** @type {any[]} */
    const rows = [];
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(PAGE_DELAY_MS, ctx);
      const url = `${requisitionsUrl(board)}?offset=${page}&size=${PAGE_SIZE}`;
      // redirect:'error' + the host check above pin every hop to the UKG Ready host (SSRF).
      const json = /** @type {any} */ (await ctx.fetchJson(url, { redirect: 'error' }));
      const batch = Array.isArray(json?.job_requisitions) ? json.job_requisitions : [];
      if (batch.length === 0) break;
      rows.push(...batch);
      const total = Number(json?._paging?.total);
      if (Number.isFinite(total) && rows.length >= total) break;
    }

    let currency = '';
    if (rows.some(statesPay)) {
      try {
        const s = /** @type {any} */ (await ctx.fetchJson(settingsUrl(board), { redirect: 'error' }));
        if (typeof s?.locale?.currency_code === 'string') currency = s.locale.currency_code;
      } catch {
        // Without the tenant currency, pay is dropped rather than guessed.
      }
    }
    return parseUkgReadyRows(rows, board, entry.name, currency);
  },
};
