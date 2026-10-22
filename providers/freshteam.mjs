// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Freshteam (Freshworks ATS) provider — server-rendered `/jobs?page=N` listing of
// `<tenant>.freshteam.com`. Each card is an <a href="/jobs/<12-char id>/<slug>"> carrying
// data-portal-location / data-portal-remote-location and a .job-title, so no per-job
// detail request is needed (description/date omitted; the card snippet is truncated).
// Provenance: github.com/strelov1/freehire internal/ingest/sources/freshteam.go (MIT);
// freehire also fetches each job page's ld+json — Jobber stays list-only.
// Live-probed 2026-10-21 on https://simera-talent.freshteam.com/jobs (1000 jobs/page, ~1.4 MB).

import { decodeEntities } from './_html-entities.mjs';

const HOST_RE = /^[a-z0-9][a-z0-9-]*\.freshteam\.com$/;
const DEFAULT_MAX_PAGES = 5;
const HARD_MAX_PAGES = 50;
const PAGE_DELAY_MS = 500;

/** @param {unknown} raw @returns {string | null} */
function originFrom(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !HOST_RE.test(u.hostname) || u.hostname === 'www.freshteam.com') return null;
  return `https://${u.hostname}`;
}

/** @param {string} url */
function assertFreshteamUrl(url) {
  if (!originFrom(url)) throw new Error(`freshteam: untrusted or non-HTTPS URL "${url}" — must be https://<tenant>.freshteam.com`);
  return url;
}

const text = (/** @type {string} */ html) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Parse one `/jobs` listing page. Exported for unit tests.
 * @param {string} html
 * @param {string} origin e.g. "https://acme.freshteam.com"
 * @param {string} company fallback company (entry.name)
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseFreshteamListing(html, origin, company) {
  if (typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const [, attrs, body] = m;
    const id = /\bhref="\/jobs\/([A-Za-z0-9_-]{12})(?:[/?#][^"]*)?"/.exec(attrs)?.[1];
    const title = text(/class="job-title"[^>]*>([\s\S]*?)<\/div>/.exec(body)?.[1] ?? '');
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const loc = decodeEntities(/\bdata-portal-location="([^"]*)"/.exec(attrs)?.[1] ?? '').trim();
    const remote = /\bdata-portal-remote-location=["']?true\b/.test(attrs);
    out.push({
      title,
      url: `${origin}/jobs/${id}`,
      company,
      location: [loc, remote ? 'Remote' : ''].filter(Boolean).join(', '),
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'freshteam',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const origin = originFrom(entry?.careers_url);
    return origin ? { url: `${origin}/jobs` } : null;
  },

  async fetch(entry, ctx) {
    const origin = originFrom(entry?.careers_url);
    if (!origin) throw new Error(`freshteam: cannot derive board for ${entry?.name}`);
    const requested = typeof ctx?.maxPages === 'number' ? ctx.maxPages : DEFAULT_MAX_PAGES;
    const maxPages = Math.max(1, Math.min(requested, HARD_MAX_PAGES));
    const sleep = (/** @type {number} */ ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const seen = new Set();
    /** @type {any[]} */
    const jobs = [];
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(PAGE_DELAY_MS);
      // redirect:'error' + the host check keep every request pinned to the tenant (SSRF).
      const html = await ctx.fetchText(assertFreshteamUrl(`${origin}/jobs?page=${page}`), { redirect: 'error' });
      const fresh = parseFreshteamListing(html, origin, entry.name).filter((j) => !seen.has(j.url));
      if (fresh.length === 0) break; // empty page, or a board that repeats its last page
      for (const j of fresh) { seen.add(j.url); jobs.push(j); }
    }
    return jobs;
  },
};
