// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// CareerPlug provider — server-rendered `/jobs?page=N` listing of
// `<board>.careerplug.com`. Each row carries title, location and post date, so
// no per-job detail request is needed (description/salary are omitted).
// Provenance: github.com/strelov1/freehire internal/ingest/sources/careerplug.go (MIT);
// freehire also fetches each job page for ld+json — Jobber stays list-only (zero extra hits).
// Live-probed 2026-10-21 on https://golden-corral-careers.careerplug.com/jobs (30 jobs/page).

import { decodeEntities } from './_html-entities.mjs';

const HOST_RE = /^[a-z0-9][a-z0-9-]*\.careerplug\.com$/;
const DEFAULT_MAX_PAGES = 5;
const HARD_MAX_PAGES = 50;
const PAGE_DELAY_MS = 500;

/** @param {unknown} raw @returns {string | null} origin `https://<board>.careerplug.com` */
function originFrom(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !HOST_RE.test(u.hostname) || u.hostname === 'www.careerplug.com') return null;
  return `https://${u.hostname}`;
}

/** @param {import('./_types.js').PortalEntry} entry */
const resolveOrigin = (entry) => originFrom(entry?.careers_url);

/** @param {string} url */
function assertCareerPlugUrl(url) {
  if (!originFrom(url)) throw new Error(`careerplug: untrusted or non-HTTPS URL "${url}" — must be https://<board>.careerplug.com`);
  return url;
}

const text = (/** @type {string} */ html) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** `MM-DD-YY` (en-US listing) → epoch ms, else undefined. */
function parsePostDate(s) {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  const [mo, d, y] = [Number(m[1]), Number(m[2]), 2000 + Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return Date.UTC(y, mo - 1, d);
}

/**
 * Parse one `/jobs` listing page. Exported for unit tests.
 * @param {string} html
 * @param {string} origin e.g. "https://acme.careerplug.com"
 * @param {string} company fallback company (entry.name)
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseCareerPlugListing(html, origin, company) {
  if (typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*\bhref="\/jobs\/(\d+)(?:[?#][^"]*)?"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, id, body] = m;
    const title = text(/class="name"[^>]*>([\s\S]*?)<\/span>/.exec(body)?.[1] ?? '');
    if (!title || seen.has(id)) continue;
    seen.add(id);
    const loc = /class="job-location[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="job-post-date|$)/.exec(body)?.[1] ?? '';
    const date = /class="job-post-date[^"]*"[^>]*>([\s\S]*)$/.exec(body)?.[1] ?? '';
    const job = {
      title,
      url: `${origin}/jobs/${id}`,
      company,
      location: text(loc).replace(/^Location:\s*/i, ''),
    };
    const postedAt = parsePostDate(text(date).replace(/^Post Date:\s*/i, ''));
    if (postedAt !== undefined) /** @type {any} */ (job).postedAt = postedAt;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'careerplug',

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}/jobs` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`careerplug: cannot derive board for ${entry?.name}`);
    const requested = typeof ctx?.maxPages === 'number' ? ctx.maxPages : DEFAULT_MAX_PAGES;
    const maxPages = Math.max(1, Math.min(requested, HARD_MAX_PAGES));
    const sleep = (/** @type {number} */ ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const company = entry.name;
    const seen = new Set();
    /** @type {any[]} */
    const jobs = [];
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(PAGE_DELAY_MS);
      const url = assertCareerPlugUrl(page === 1 ? `${origin}/jobs` : `${origin}/jobs?page=${page}`);
      // redirect:'error' + the host check keep every request pinned to the tenant (SSRF).
      const html = await ctx.fetchText(url, { redirect: 'error' });
      const fresh = parseCareerPlugListing(html, origin, company).filter((j) => !seen.has(j.url));
      if (fresh.length === 0) break; // empty page, or a board that repeats its last page
      for (const j of fresh) { seen.add(j.url); jobs.push(j); }
    }
    return jobs;
  },
};
