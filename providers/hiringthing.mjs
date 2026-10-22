// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// HiringThing provider — the whole board is rendered on the tenant root page
// `https://<tenant>.hiringthing.com/` (no pagination), one `.job-container` per
// posting with title + location. Description/date/salary live only on the per-job
// page, so they are omitted (zero-token, list-only; the card snippet is truncated).
// Provenance: github.com/strelov1/freehire internal/ingest/sources/hiringthing.go (MIT).
// Live-probed 2026-10-21 on https://skijapan.hiringthing.com/ (40 postings).
// Reseller white-label hosts (e.g. *.prismhr-hire.com) are NOT accepted — only hiringthing.com.

import { decodeEntities } from './_html-entities.mjs';

const HOST_RE = /^[a-z0-9][a-z0-9-]*\.hiringthing\.com$/;

/** @param {unknown} raw @returns {string | null} */
function originFrom(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !HOST_RE.test(u.hostname) || u.hostname === 'www.hiringthing.com') return null;
  return `https://${u.hostname}`;
}

/** @param {string} url */
function assertHiringThingUrl(url) {
  if (!originFrom(url)) throw new Error(`hiringthing: untrusted or non-HTTPS URL "${url}" — must be https://<tenant>.hiringthing.com`);
  return url;
}

const text = (/** @type {string} */ html) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Parse the board root page. Exported for unit tests.
 * @param {string} html
 * @param {string} origin e.g. "https://skijapan.hiringthing.com"
 * @param {string} company fallback company (entry.name)
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseHiringThingListing(html, origin, company) {
  if (typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();
  for (const block of html.split(/<div\b[^>]*\bclass="job-container"/).slice(1)) {
    const m = /\bhref="\/job\/(\d+)(?:\/[^"?#]*)?(?:[?#][^"]*)?"/.exec(block);
    const title = text(/<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1] ?? '');
    if (!m || !title || seen.has(m[1])) continue;
    seen.add(m[1]);
    const location = text(/class="job-location"[^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1] ?? '');
    out.push({ title, url: `${origin}/job/${m[1]}`, company, location });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'hiringthing',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const origin = originFrom(entry?.careers_url);
    return origin ? { url: `${origin}/` } : null;
  },

  async fetch(entry, ctx) {
    const origin = originFrom(entry?.careers_url);
    if (!origin) throw new Error(`hiringthing: cannot derive board for ${entry?.name}`);
    const url = assertHiringThingUrl(`${origin}/`);
    // redirect:'error' + the host check keep the request pinned to the tenant (SSRF).
    const html = await ctx.fetchText(url, { redirect: 'error' });
    return parseHiringThingListing(html, origin, entry.name);
  },
};
