// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// HiringRoom provider — Latin American ATS (AR/PE/CL/EC/PA): one
// `<tenant>.hiringroom.com` job portal per employer. The portal page renders
// only its first 20 vacancies; its own pager POSTs
// `/jobs/getVacanciesForPortal/<page>` (form body, no CSRF token or cookie) and
// gets JSON back carrying the page's vacancy cards as an HTML fragment plus the
// portal total. Cards hold title and location but no body, so `description` is
// omitted (no per-vacancy request).
//
// PROVENANCE: adapted from github.com/strelov1/freehire
// internal/ingest/sources/hiringroom.go (MIT). Live probe 2026-10-21:
// POST https://tatachile.hiringroom.com/jobs/getVacanciesForPortal/1 → 200,
// 20 cards, total_vacancies 34, no auth.
//
// Auto-detects from `https://<tenant>.hiringroom.com[/...]`.

import { decodeEntities } from './_html-entities.mjs';

const HOST_RE = /^([a-z0-9][a-z0-9-]*)\.hiringroom\.com$/;
// Vendor-owned labels, never a tenant portal (freehire atsboard reserved list).
const RESERVED_TENANTS = new Set(['www', 've', 'api-ve', 'contacto-comercial']);
const VACANCY_ID_RE = /^[0-9a-f]{24}$/;
const DEFAULT_MAX_PAGES = 5;
const INTER_PAGE_DELAY_MS = 150;

/** @param {string} hostname */
function tenantOf(hostname) {
  const m = HOST_RE.exec(hostname);
  return m && !RESERVED_TENANTS.has(m[1]) ? m[1] : null;
}

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null} tenant label
 */
function resolveTenant(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port) return null;
  return tenantOf(u.hostname);
}

/** @param {string} url */
function assertHiringRoomUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`hiringroom: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:' || u.port || !tenantOf(u.hostname)) {
    throw new Error(`hiringroom: untrusted URL "${url}" — must be https://<tenant>.hiringroom.com/…`);
  }
  return url;
}

/** @param {string} html */
function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Parse the `data.htmlContent` fragment of one pager response into Jobs.
 * A card is an `<a href="/jobs/get_vacancy/<24-hex>">` wrapping the title
 * (`name__vacancy`) and icon-tagged facts. Exported for unit tests.
 * @param {string} fragment
 * @param {string} tenant
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseHiringRoomCards(fragment, tenant, companyName) {
  const jobs = [];
  for (const card of String(fragment || '').split(/<a\b[^>]*?href="\/jobs\/get_vacancy\//).slice(1)) {
    const id = card.slice(0, 24);
    const title = textOf((/\bname__vacancy\b[^>]*>([\s\S]*?)<\//.exec(card) || [])[1] || '');
    if (!VACANCY_ID_RE.test(id) || !/^["']/.test(card.slice(24)) || !title) continue;
    const place = textOf((/<i class="[^"]*\bhr-Location-pin\b[^"]*"><\/i>([\s\S]*?)<\/span>/.exec(card) || [])[1] || '');
    const remote = /<i class="[^"]*\bhr-Remote\b/.test(card);
    jobs.push({
      title,
      url: `https://${tenant}.hiringroom.com/jobs/get_vacancy/${id}`,
      company: companyName,
      location: [place, remote ? 'Remote' : ''].filter(Boolean).join(', '),
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'hiringroom',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const tenant = resolveTenant(entry);
    return tenant ? { url: `https://${tenant}.hiringroom.com/jobs/getVacanciesForPortal/1` } : null;
  },

  async fetch(entry, ctx) {
    const tenant = resolveTenant(entry);
    if (!tenant) throw new Error(`hiringroom: cannot derive tenant for ${entry.name}`);
    const maxPages = Math.min(DEFAULT_MAX_PAGES, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
    const sleep = (/** @type {number} */ ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    /** @type {Map<string, any>} */
    const seen = new Map();
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS);
      const url = assertHiringRoomUrl(`https://${tenant}.hiringroom.com/jobs/getVacanciesForPortal/${page}`);
      const resp = /** @type {any} */ (await ctx.fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: `selectedPage=${page}&typePortal=external`,
        redirect: 'error',
      }));
      if (resp?.result !== 'success') throw new Error(`hiringroom: page ${page} answered ${JSON.stringify(resp?.result)}`);
      const before = seen.size;
      for (const j of parseHiringRoomCards(resp.data?.htmlContent, tenant, entry.name)) if (!seen.has(j.url)) seen.set(j.url, j);
      const total = Number(resp.data?.total_vacancies);
      if (seen.size === before || (Number.isFinite(total) && seen.size >= total)) break; // empty page or portal total reached
    }
    return [...seen.values()];
  },
};
