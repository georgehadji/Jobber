// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// HR-Manager (hr-manager.net) provider — Danish ATS, public job-portal JSON API.
// Provenance: ported from github.com/strelov1/freehire internal/ingest/sources/hrmanager.go (MIT).
// Live-probed 2026-10-21 on customer alias "energinet":
//   GET https://api.hr-manager.net/jobportal.svc/energinet/positionlist/json/?incads=1&take=2000
//   -> 200 JSON {CustomerAlias, TransactionStatus, Items[37], PositionCountSearch, PositionCountList}, no auth.
//
// A board is the customer ALIAS (not the numeric cid in posting URLs). Auto-detects from
//   https://candidate.hr-manager.net/vacancies/list.aspx?customer=<alias>
//   https://api.hr-manager.net/JobPortal.svc/<alias>/...
// or an explicit `provider: hrmanager` + `board: <alias>`. One request returns the whole board
// (take > customer size) with the advertisement HTML inline (incads=1); no pagination.

import { decodeEntities } from './_html-entities.mjs';

const ALIAS_RE = /^[A-Za-z0-9_-]+$/;
const POSTING_HOST_RE = /^(?:[a-z0-9-]+\.)*hr-manager\.net$/i;
const TAKE = 1000;

/** @param {import('./_types.js').PortalEntry} entry @returns {string | null} customer alias */
function resolveAlias(entry) {
  if (entry.provider === 'hrmanager' && typeof entry.board === 'string' && ALIAS_RE.test(entry.board.trim())) {
    return entry.board.trim();
  }
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'candidate.hr-manager.net') {
    const alias = u.searchParams.get('customer') ?? '';
    // an alias always contains a letter; `customer=316` is the platform's "unknown department" page
    return ALIAS_RE.test(alias) && /[A-Za-z]/.test(alias) ? alias : null;
  }
  if (host === 'api.hr-manager.net') {
    const segs = u.pathname.split('/').filter(Boolean);
    return segs[0]?.toLowerCase() === 'jobportal.svc' && segs[1] && ALIAS_RE.test(segs[1]) ? segs[1] : null;
  }
  return null;
}

/** @param {string} alias */
export function listUrl(alias) {
  return `https://api.hr-manager.net/jobportal.svc/${alias}/positionlist/json/?incads=1&take=${TAKE}`;
}

/** .NET JSON date "/Date(1791377991000+0200)/" -> epoch ms; non-positive (MinValue) -> null. @param {unknown} v */
export function parseDotNetDate(v) {
  const m = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(String(v ?? ''));
  const ms = m ? Number(m[1]) : 0;
  return ms > 0 ? ms : null;
}

/** @param {string} html */
function htmlToText(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|h\d|tr)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * Normalize a positionlist response. Exported for unit tests.
 * Throws when the API reports an error or answers for a different customer (an error body
 * would otherwise read as an empty board). Standing "OpenApplication" entries are skipped.
 * @param {any} json
 * @param {string} alias
 * @param {string} companyName
 */
export function parseHrManagerList(json, alias, companyName) {
  const code = json?.TransactionStatus?.StatusCode;
  if (code !== 0 || !Array.isArray(json?.Items)) {
    throw new Error(`hrmanager: board "${alias}": listing status ${code} (${String(json?.TransactionStatus?.Description ?? '').trim()})`);
  }
  if (String(json.CustomerAlias ?? '').toLowerCase() !== alias.toLowerCase()) {
    throw new Error(`hrmanager: board "${alias}": listing names customer "${json.CustomerAlias}"`);
  }
  const out = [];
  for (const it of json.Items) {
    if (!it || it.ProjectType === 'OpenApplication') continue;
    const title = String(it.Name ?? '').split(/\s+/).filter(Boolean).join(' ');
    let url;
    try {
      const u = new URL(String(it.AdvertisementUrl ?? ''));
      if (u.protocol !== 'https:' || !POSTING_HOST_RE.test(u.hostname)) continue;
      url = u.href;
    } catch {
      continue;
    }
    if (!(Number(it.Id) > 0) || !title) continue;
    const location =
      String(it.WorkPlace ?? '').trim() ||
      (Array.isArray(it.PositionLocationMultiSelection) ? it.PositionLocationMultiSelection : [])
        .map((/** @type {any} */ n) => String(n?.Name ?? '').trim())
        .filter(Boolean)
        .join('; ') ||
      String(it.Department?.City ?? '').trim();
    /** @type {import('./_types.js').Job} */
    const job = { title, url, company: companyName, location };
    const ad = (Array.isArray(it.Advertisements) ? it.Advertisements : []).find((/** @type {any} */ a) => String(a?.Content ?? '').trim());
    const description = ad ? htmlToText(`${ad.Introduction ?? ''}${ad.Content}`) : '';
    if (description) job.description = description;
    const posted = parseDotNetDate(it.Published) ?? parseDotNetDate(it.Created);
    if (posted) job.postedAt = posted;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'hrmanager',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const alias = resolveAlias(entry);
    return alias ? { url: listUrl(alias) } : null;
  },

  async fetch(entry, ctx) {
    const alias = resolveAlias(entry);
    if (!alias) throw new Error(`hrmanager: cannot derive customer alias for ${entry.name}`);
    const json = await ctx.fetchJson(listUrl(alias), { redirect: 'error' });
    return parseHrManagerList(json, alias, entry.name);
  },
};
