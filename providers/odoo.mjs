// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';

// Odoo (website_hr_recruitment) provider — ONLY Odoo-hosted careers sites at
// <tenant>.odoo.com. Self-hosted Odoo sites live on arbitrary company domains
// and cannot be recognised or SSRF-checked safely, so they are out of scope.
// Ported from freehire (github.com/strelov1/freehire,
// internal/ingest/sources/odoo.go, MIT). Live-probed 2026-10-21 with
// hhgjapan.odoo.com and factual-careers2.odoo.com (200, no auth).
//
// GET https://<tenant>.odoo.com/jobs is server-rendered and unpaginated; each
// card is <a href="/jobs/<slug>-<id>"> holding an <h3> title and schema.org
// address spans (addressLocality / addressCountry). The description and
// datePosted need a per-job request the zero-token scanner skips, so they are
// omitted. A language prefix in careers_url (/en/jobs) is preserved because
// multilingual tenants redirect bare /jobs, and redirect:'error' forbids that.

const ODOO_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.odoo\.com$/;
// Odoo's own marketing/app hosts — not tenant career sites.
const RESERVED = new Set(['www', 'apps', 'accounts', 'api', 'download', 'demo', 'runbot', 'upgrade', 'iap', 'odoo', 'nightly']);
const LANG_JOBS_RE = /^(\/[a-z]{2,3}(?:_[A-Za-z]{2})?)?\/jobs(?:\/|$)/;

/**
 * Listing URL (`https://<tenant>.odoo.com[/<lang>]/jobs`) from an entry, or null.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveListUrl(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const m = ODOO_HOST_RE.exec(u.hostname);
  if (!m || RESERVED.has(m[1])) return null;
  const lang = LANG_JOBS_RE.exec(u.pathname)?.[1] ?? '';
  return `https://${u.hostname}${lang}/jobs`;
}

/** @param {string} s */
function cleanText(s) {
  // Single-pass decode: chained replaces turned `&amp;lt;` into `<` (CodeQL double-unescape).
  return decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {string} html @param {string} prop */
function itemprop(html, prop) {
  const m = new RegExp(`itemprop="${prop}"[^>]*>([\\s\\S]*?)</`).exec(html);
  return m ? cleanText(m[1]) : '';
}

/**
 * Parse the listing HTML. Exported for unit tests. Only same-host
 * `/jobs/<slug>-<id>` (or `/jobs/detail/<slug>-<id>`) cards are kept.
 * @param {string} html
 * @param {string} listUrl  the fetched listing URL (its origin pins the host)
 * @param {string} companyName
 */
export function parseOdooListing(html, listUrl, companyName) {
  const base = new URL(listUrl);
  /** @type {Array<{title: string, url: string, company: string, location: string}>} */
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of String(html).matchAll(re)) {
    let u;
    try {
      u = new URL(m[1].replace(/&amp;/g, '&'), base);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' || u.hostname !== base.hostname) continue;
    if (!/\/jobs\/(?:detail\/)?[^/?#]*-\d+\/?$/.test(u.pathname)) continue;
    const url = `${u.origin}${u.pathname}`;
    if (seen.has(url)) continue;
    const title = cleanText(/<h\d[^>]*>([\s\S]*?)<\/h\d>/i.exec(m[2])?.[1] ?? '');
    if (!title) continue;
    seen.add(url);
    const location = [itemprop(m[2], 'addressLocality'), itemprop(m[2], 'addressCountry')].filter(Boolean).join(', ');
    out.push({ title, url, company: companyName, location });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'odoo',

  detect(entry) {
    const url = resolveListUrl(entry);
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const url = resolveListUrl(entry);
    if (!url) throw new Error(`odoo: careers_url must be https://<tenant>.odoo.com for ${entry.name}`);
    const html = await ctx.fetchText(url, { redirect: 'error' });
    return parseOdooListing(html, url, entry.name);
  },
};
