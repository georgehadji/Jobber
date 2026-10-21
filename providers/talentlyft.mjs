// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// TalentLyft provider — career sites at <tenant>.talentlyft.com.
// Ported from freehire (github.com/strelov1/freehire,
// internal/ingest/sources/talentlyft.go, MIT). Live-probed 2026-10-21 with
// tenant `inetec` (200, no auth).
//
// The careers root is a JS app with no job links, so the tenant's
// /sitemap.xml enumerates /jobs/<slug>-<code> postings and each posting page
// server-renders a schema.org JobPosting ld+json block (title, location,
// datePosted, description). That is one request per posting, so the walk is
// capped at PER_PAGE postings per ctx.maxPages (default 5), fetched in small
// concurrent batches with ctx.sleep pacing between them.

import { decodeEntities } from './_html-entities.mjs';

const TALENTLYFT_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.talentlyft\.com$/;
const RESERVED = new Set(['www', 'app', 'api', 'help', 'support', 'status']);
const JOB_PATH_RE = /^\/jobs\/.+-[A-Za-z0-9]{3,}$/;
const PER_PAGE = 20;
const BATCH = 4;
const DEFAULT_MAX_PAGES = 5;

/** @param {unknown} s */
function htmlToText(s) {
  // ld+json descriptions are entity-escaped HTML: decode, strip tags, decode again.
  const raw = decodeEntities(String(s ?? ''))
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(raw).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/**
 * Tenant host (`<tenant>.talentlyft.com`) from an entry, or null.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveHost(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const m = TALENTLYFT_HOST_RE.exec(u.hostname);
  return m && !RESERVED.has(m[1]) ? u.hostname : null;
}

/**
 * Posting URLs from a sitemap.xml body, restricted to https /jobs/<slug>-<code>
 * on `host` (drops the root and section pages). Exported for unit tests.
 * @param {string} xml
 * @param {string} host
 * @returns {string[]}
 */
export function parseSitemapJobUrls(xml, host) {
  const urls = [];
  const seen = new Set();
  for (const m of String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    let u;
    try {
      u = new URL(decodeEntities(m[1]));
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' || u.hostname !== host || !JOB_PATH_RE.test(u.pathname.replace(/\/$/, ''))) continue;
    const url = `https://${host}${u.pathname.replace(/\/$/, '')}`;
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

/**
 * Map one posting page to a Job via its JobPosting ld+json, or null.
 * Exported for unit tests.
 * @param {string} html
 * @param {string} url
 * @param {string} companyName
 */
export function parsePostingPage(html, url, companyName) {
  for (const m of String(html).matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    for (const node of Array.isArray(data) ? data : [data]) {
      if (node?.['@type'] !== 'JobPosting') continue;
      const title = typeof node.title === 'string' ? decodeEntities(node.title).trim() : '';
      if (!title) continue;
      const addr = (Array.isArray(node.jobLocation) ? node.jobLocation[0] : node.jobLocation)?.address ?? {};
      const country = typeof addr.addressCountry === 'string' ? addr.addressCountry : addr.addressCountry?.name;
      /** @type {{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}} */
      const job = {
        title,
        url,
        company: companyName,
        location: [addr.addressLocality, country].filter(s => typeof s === 'string' && s.trim()).join(', '),
      };
      const description = htmlToText(node.description);
      if (description) job.description = description;
      const ts = typeof node.datePosted === 'string' ? Date.parse(node.datePosted) : NaN;
      if (Number.isFinite(ts)) job.postedAt = ts;
      return job;
    }
  }
  return null;
}

/** @type {Provider} */
export default {
  id: 'talentlyft',

  detect(entry) {
    const host = resolveHost(entry);
    return host ? { url: `https://${host}/sitemap.xml` } : null;
  },

  async fetch(entry, ctx) {
    const host = resolveHost(entry);
    if (!host) throw new Error(`talentlyft: cannot derive tenant host for ${entry.name}`);
    const maxPages = Number.isInteger(ctx.maxPages) && /** @type {number} */ (ctx.maxPages) > 0 ? /** @type {number} */ (ctx.maxPages) : DEFAULT_MAX_PAGES;
    const sleep = ctx.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    const xml = await ctx.fetchText(`https://${host}/sitemap.xml`, { redirect: 'error' });
    const urls = parseSitemapJobUrls(xml, host).slice(0, PER_PAGE * maxPages);
    /** @type {Array<NonNullable<ReturnType<typeof parsePostingPage>>>} */
    const jobs = [];
    for (let i = 0; i < urls.length; i += BATCH) {
      const batch = urls.slice(i, i + BATCH);
      const pages = await Promise.all(
        batch.map(async url => {
          try {
            return parsePostingPage(await ctx.fetchText(url, { redirect: 'error' }), url, entry.name);
          } catch {
            return null; // one unreadable posting must not fail the board
          }
        }),
      );
      for (const j of pages) if (j) jobs.push(j);
      if (i + BATCH < urls.length) await sleep(250);
    }
    return jobs;
  },
};
