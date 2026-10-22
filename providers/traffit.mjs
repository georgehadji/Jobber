// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Traffit provider — Polish-rooted ATS; career sites at <tenant>.traffit.com.
// Ported from freehire (github.com/strelov1/freehire,
// internal/ingest/sources/traffit.go, MIT). Live-probed 2026-10-21 with tenant
// `cloudfide` (200, 4 postings with inline HTML description, no auth).
//
//   GET https://<tenant>.traffit.com/public/an/list/?limit=100&offset=N
//   → { count, items: [{ advertId, advertPublishId, title, name, url,
//        description, geolocation (JSON string), validStart (epoch s) }] }
// The list endpoint clamps a page at 100 items.

import { decodeEntities } from './_html-entities.mjs';

const TRAFFIT_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.traffit\.com$/;
const RESERVED = new Set(['www', 'app', 'api', 'help', 'support', 'status']);
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;

/** @param {unknown} s */
function htmlToText(s) {
  const raw = String(s ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(raw).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveTenant(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const m = TRAFFIT_HOST_RE.exec(u.hostname);
  return m && !RESERVED.has(m[1]) ? m[1] : null;
}

/**
 * @param {string} tenant
 * @param {number} offset
 */
function pageUrl(tenant, offset) {
  return `https://${tenant}.traffit.com/public/an/list/?limit=${PAGE_SIZE}&offset=${offset}`;
}

/** @param {unknown} geo  JSON-string geolocation → "Locality, Region, Country" */
function geoToLocation(geo) {
  if (typeof geo !== 'string' || !geo) return '';
  try {
    const g = JSON.parse(geo);
    return [g?.locality, g?.region1, g?.country]
      .filter(s => typeof s === 'string' && s.trim())
      .map(s => s.trim())
      .join(', ');
  } catch {
    return '';
  }
}

/**
 * Parse one Traffit list page. Exported for unit tests. Rows without an id,
 * title, or a posting URL on the tenant's own host are dropped.
 * @param {any} json
 * @param {string} tenant
 * @param {string} companyName
 */
export function parseTraffitPage(json, tenant, companyName) {
  const items = json?.items;
  if (!Array.isArray(items)) return [];
  /** @type {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>} */
  const out = [];
  for (const it of items) {
    if (!it || !(Number(it.advertId) || Number(it.advertPublishId))) continue;
    const title = String(it.title || it.name || '').trim();
    if (!title) continue;
    let url = '';
    try {
      const u = new URL(String(it.url));
      if (u.protocol === 'https:' && u.hostname === `${tenant}.traffit.com`) url = u.href;
    } catch {
      /* dropped below */
    }
    if (!url) continue;
    /** @type {{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}} */
    const job = { title, url, company: companyName, location: geoToLocation(it.geolocation) };
    const description = htmlToText(it.description);
    if (description) job.description = description;
    if (Number.isFinite(it.validStart) && it.validStart > 0) job.postedAt = it.validStart * 1000;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'traffit',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const t = resolveTenant(entry);
    return t ? { url: pageUrl(t, 0) } : null;
  },

  async fetch(entry, ctx) {
    const tenant = resolveTenant(entry);
    if (!tenant) throw new Error(`traffit: cannot derive tenant for ${entry.name}`);
    const maxPages = Number.isInteger(ctx.maxPages) && /** @type {number} */ (ctx.maxPages) > 0 ? /** @type {number} */ (ctx.maxPages) : DEFAULT_MAX_PAGES;
    const sleep = ctx.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    /** @type {ReturnType<typeof parseTraffitPage>} */
    const jobs = [];
    let seen = 0;
    for (let page = 0; page < maxPages; page++) {
      const json = /** @type {any} */ (await ctx.fetchJson(pageUrl(tenant, page * PAGE_SIZE), { redirect: 'error' }));
      const items = Array.isArray(json?.items) ? json.items : [];
      if (items.length === 0) break;
      jobs.push(...parseTraffitPage(json, tenant, entry.name));
      seen += items.length;
      if (seen >= Number(json?.count)) break;
      await sleep(250);
    }
    return jobs;
  },
};
