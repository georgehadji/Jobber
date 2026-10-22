// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// CATS (catsone.com) provider — the server-rendered career-portal table at
// `https://<tenant>.catsone.com/careers/<portalId>`: one `<a class="table-row">` per job
// carrying title (.title-cell) and location (data-label="Location"). No pagination.
// Description/date live on the per-job page and are omitted (zero-token, list-only).
// The portal id is REQUIRED in careers_url: bare `/careers` answers a 307 to
// `/careers/<portalId>`, and providers never follow redirects (redirect:'error').
// Provenance: github.com/strelov1/freehire internal/ingest/sources/catsone.go (MIT).
// Live-probed 2026-10-21 on https://sphereinc.catsone.com/careers/90438 (14 jobs).
// Custom-domain CATS portals (jobs.<company>.com) are not supported — only *.catsone.com.

import { decodeEntities } from './_html-entities.mjs';

const HOST_RE = /^[a-z0-9][a-z0-9-]*\.catsone\.com$/;
const PORTAL_PATH_RE = /^\/careers\/(\d+)(?:\/|$)/;

/** @param {unknown} raw @returns {{origin: string, portal: string} | null} */
function portalFrom(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !HOST_RE.test(u.hostname) || u.hostname === 'www.catsone.com') return null;
  const m = PORTAL_PATH_RE.exec(u.pathname);
  return m ? { origin: `https://${u.hostname}`, portal: m[1] } : null;
}

/** @param {string} url */
function assertCatsUrl(url) {
  if (!portalFrom(url)) throw new Error(`catsone: untrusted or non-HTTPS URL "${url}" — must be https://<tenant>.catsone.com/careers/<portalId>`);
  return url;
}

const text = (/** @type {string} */ html) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Parse the portal table. Exported for unit tests.
 * @param {string} html
 * @param {string} origin e.g. "https://acme.catsone.com"
 * @param {string} portal numeric portal id the listing belongs to
 * @param {string} company fallback company (entry.name)
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseCatsListing(html, origin, portal, company) {
  if (typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const [, attrs, body] = m;
    if (!/\bclass="[^"]*\btable-row\b/.test(attrs)) continue;
    // Only this portal's job permalinks: /careers/<portal>/jobs/<id>[-slug]
    const href = new RegExp(`\\bhref="(/careers/${portal}/jobs/(\\d+)[A-Za-z0-9._~%-]*)"`).exec(attrs);
    const title = text(/class="[^"]*\btitle-cell\b[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(body)?.[1] ?? '');
    if (!href || !title || seen.has(href[2])) continue;
    seen.add(href[2]);
    const location = text(/data-label="Location"[^>]*>([\s\S]*?)<\/div>/.exec(body)?.[1] ?? '');
    out.push({ title, url: `${origin}${href[1]}`, company, location });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'catsone',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const p = portalFrom(entry?.careers_url);
    return p ? { url: `${p.origin}/careers/${p.portal}` } : null;
  },

  async fetch(entry, ctx) {
    const p = portalFrom(entry?.careers_url);
    if (!p) throw new Error(`catsone: cannot derive portal for ${entry?.name} (careers_url must be https://<tenant>.catsone.com/careers/<portalId>)`);
    const url = assertCatsUrl(`${p.origin}/careers/${p.portal}`);
    // redirect:'error' + the host check keep the request pinned to the tenant (SSRF).
    const html = await ctx.fetchText(url, { redirect: 'error' });
    return parseCatsListing(html, p.origin, p.portal, entry.name);
  },
};
