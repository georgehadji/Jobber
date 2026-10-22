// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// ADP Workforce Now provider — public careercenter staffing API (keyless JSON).
// Provenance: github.com/strelov1/freehire internal/ingest/sources/adp.go (MIT).
// Live-probed 2026-10-21 against cid=8a680274-0b2e-46cf-b2cc-49bd2ef0c20f
// ccId=19000101_000001 (HTTP 200, 20 requisitions).
//
// Auto-detects from a careers_url carrying the tenant's `cid` + `ccId` query
// params on workforcenow.adp.com (the recruitment.html URL). The host is fixed,
// so SSRF defence is an exact-host check plus strict charset on cid/ccId.
// The list payload carries title, postDate, location and (sometimes) a pay
// range; the HTML description needs a per-requisition detail request, which the
// zero-token scanner skips (description omitted).

const ADP_HOST = 'workforcenow.adp.com';
const API_BASE = `https://${ADP_HOST}/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions`;
const PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 5;
const PAGE_DELAY_MS = 300;
const CID_RE = /^[A-Za-z0-9-]{1,64}$/;
const CCID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Pull `{cid, ccId}` from an ADP Workforce Now URL; null if not a valid one.
 * @param {unknown} raw
 * @returns {{cid: string, ccId: string} | null}
 */
export function parseAdpUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== ADP_HOST) return null;
  const cid = u.searchParams.get('cid') ?? '';
  const ccId = u.searchParams.get('ccId') ?? '';
  if (!CID_RE.test(cid) || !CCID_RE.test(ccId)) return null;
  return { cid, ccId };
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveBoard(entry) {
  return parseAdpUrl(entry.api) ?? parseAdpUrl(entry.careers_url);
}

/** @param {string} url */
function assertAdpUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`adp: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:') throw new Error(`adp: URL must use HTTPS: ${url}`);
  if (u.hostname !== ADP_HOST) throw new Error(`adp: untrusted hostname "${u.hostname}" — must be ${ADP_HOST}`);
  return url;
}

/** @param {string} cid @param {string} ccId @param {number} skip */
function listUrl(cid, ccId, skip) {
  return assertAdpUrl(
    `${API_BASE}?cid=${encodeURIComponent(cid)}&ccId=${encodeURIComponent(ccId)}&lang=en_US&locale=en_US&%24top=${PAGE_SIZE}&%24skip=${skip}`,
  );
}

/**
 * Annual pay range from a requisition, only when ADP labels the period
 * "Annually" (SalaryType code AN). Unknown period → undefined (omitted).
 * @param {any} r
 */
function annualSalary(r) {
  const range = r?.payGradeRange;
  const fields = r?.customFieldGroup?.codeFields;
  if (!range || !Array.isArray(fields)) return undefined;
  const annual = fields.some(f => f?.nameCode?.codeValue === 'SalaryType' && f?.codeValue === 'AN');
  if (!annual) return undefined;
  const num = (/** @type {any} */ v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const min = num(range.minimumRate?.amountValue);
  const max = num(range.maximumRate?.amountValue);
  if (min === null && max === null) return undefined;
  const currency = String(range.minimumRate?.currencyCode ?? range.maximumRate?.currencyCode ?? '');
  return { min, max, currency };
}

/**
 * Normalize an ADP `job-requisitions` list payload. Exported for unit tests.
 * Rows without itemID or title are dropped (itemID is the URL / dedup key).
 * @param {any} json
 * @param {string} companyName
 * @param {{cid: string, ccId: string}} board
 * @returns {import('./_types.js').Job[]}
 */
export function parseAdpResponse(json, companyName, board) {
  const rows = json?.jobRequisitions;
  if (!Array.isArray(rows)) return [];
  /** @type {import('./_types.js').Job[]} */
  const out = [];
  for (const r of rows) {
    const id = String(r?.itemID ?? '').trim();
    const title = String(r?.requisitionTitle ?? '').trim();
    if (!id || !title) continue;
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: `https://${ADP_HOST}/mascsr/default/mdf/recruitment/recruitment.html?cid=${encodeURIComponent(board.cid)}&ccId=${encodeURIComponent(board.ccId)}&jobId=${encodeURIComponent(id)}&lang=en_US`,
      company: companyName,
      location: String(r?.requisitionLocations?.[0]?.nameCode?.shortName ?? '').trim(),
    };
    const posted = Date.parse(r?.postDate);
    if (Number.isFinite(posted)) job.postedAt = posted;
    const salary = annualSalary(r);
    if (salary) job.salary = salary;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'adp',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const board = resolveBoard(entry);
    return board ? { url: listUrl(board.cid, board.ccId, 0) } : null;
  },

  async fetch(entry, ctx) {
    const board = resolveBoard(entry);
    if (!board) throw new Error(`adp: cannot derive cid/ccId for ${entry.name}`);
    const cap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : DEFAULT_MAX_PAGES;
    /** @type {import('./_types.js').Job[]} */
    const jobs = [];
    for (let page = 0; page < cap; page++) {
      const skip = page * PAGE_SIZE;
      const json = /** @type {any} */ (await ctx.fetchJson(listUrl(board.cid, board.ccId, skip), { redirect: 'error' }));
      const rows = Array.isArray(json?.jobRequisitions) ? json.jobRequisitions : [];
      if (rows.length === 0) break;
      jobs.push(...parseAdpResponse(json, entry.name, board));
      const total = Number(json?.meta?.totalNumber);
      if (Number.isFinite(total) && skip + rows.length >= total) break;
      if (page + 1 < cap && typeof ctx.sleep === 'function') await ctx.sleep(PAGE_DELAY_MS);
    }
    return jobs;
  },
};
