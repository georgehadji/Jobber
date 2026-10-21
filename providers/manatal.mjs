// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Manatal provider — public career-page jobs feed (the ATS behind careers-page.com).
// Provenance: ported from github.com/strelov1/freehire internal/ingest/sources/manatal.go (MIT).
// Live-probed 2026-10-21: GET https://open.api.manatal.com/open/v3/career-page/davidjoseph-co/jobs/
// -> 200, DRF page {count,next,previous,results[]} (10/page, 53 jobs), no auth.
//
// Auto-detects from careers_url `https://www.careers-page.com/<slug>[/...]` or
// `https://<slug>.careers-page.com[/...]`. The list payload carries the full HTML
// description, location and remote flag inline (no per-job request) and no publish date.
// The `next` link is followed ONLY if it stays on open.api.manatal.com (SSRF).

import { decodeEntities as decode } from './_html-entities.mjs';

const API_HOST = 'open.api.manatal.com';
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SUB_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.careers-page\.com$/;
const DEFAULT_MAX_PAGES = 10; // 10 jobs/page
const PAGE_DELAY_MS = 250;

/** @param {import('./_types.js').PortalEntry} entry @returns {string | null} tenant slug */
function resolveSlug(entry) {
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
  if (host === 'www.careers-page.com' || host === 'careers-page.com') {
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg && SLUG_RE.test(seg) ? seg : null;
  }
  const m = SUB_HOST_RE.exec(host);
  return m && m[1] !== 'www' && SLUG_RE.test(m[1]) ? m[1] : null;
}

/** @param {string} slug */
export function listUrl(slug) {
  return `https://${API_HOST}/open/v3/career-page/${encodeURIComponent(slug)}/jobs/`;
}

/** True only for an https URL on the Manatal open API host. @param {unknown} url */
export function isTrustedNext(url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === API_HOST && u.pathname.startsWith('/open/v3/career-page/');
  } catch {
    return false;
  }
}

/** @param {string} html */
function htmlToText(html) {
  return decode(
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
 * Normalize one DRF page. Exported for unit tests. Rows without a hash or title are dropped.
 * @param {any} json
 * @param {string} slug
 * @param {string} companyName
 */
export function parseManatalPage(json, slug, companyName) {
  const rows = Array.isArray(json?.results) ? json.results : [];
  const out = [];
  for (const p of rows) {
    const hash = String(p?.hash ?? '').trim();
    const title = String(p?.position_name ?? '').trim();
    if (!hash || !title || !/^[A-Za-z0-9_-]+$/.test(hash)) continue;
    const location = String(
      p.location_display || [p.city, p.state, p.country].filter(Boolean).join(', '),
    ).trim();
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: `https://www.careers-page.com/${encodeURIComponent(slug)}/job/${hash}`,
      company: companyName,
      location: p.is_remote && !/remote/i.test(location) ? [location, 'Remote'].filter(Boolean).join(', ') : location,
    };
    const description = htmlToText(p.description);
    if (description) job.description = description;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'manatal',

  detect(entry) {
    const slug = resolveSlug(entry);
    return slug ? { url: listUrl(slug) } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`manatal: cannot derive career-page slug for ${entry.name}`);
    const maxPages = ctx.maxPages && ctx.maxPages > 0 ? ctx.maxPages : Math.min(Number(entry.max_pages) || DEFAULT_MAX_PAGES, 100);
    const sleep = ctx.sleep ?? ((/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms)));
    /** @type {import('./_types.js').Job[]} */
    const jobs = [];
    const seen = new Set();
    let next = listUrl(slug);
    for (let page = 0; page < maxPages && next; page++) {
      if (!isTrustedNext(next)) throw new Error(`manatal: untrusted page URL "${next}"`);
      if (page > 0) await sleep(PAGE_DELAY_MS);
      const json = /** @type {any} */ (await ctx.fetchJson(next, { redirect: 'error' }));
      for (const j of parseManatalPage(json, slug, entry.name)) {
        if (!seen.has(j.url)) {
          seen.add(j.url);
          jobs.push(j);
        }
      }
      next = typeof json?.next === 'string' ? json.next : '';
    }
    return jobs;
  },
};
