// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// HRMOS provider — Japanese multi-tenant ATS (hrmos.co, by Bizreach). Reads the
// public server-rendered listing `https://hrmos.co/pages/<board>/jobs?page=N`
// (100 cards per page). Each card already carries the job link, title, location
// tag and a description snippet, so no per-job detail request is made.
//
// PROVENANCE: adapted from github.com/strelov1/freehire
// internal/ingest/sources/hrmos.go (MIT). The Go adapter walks the listing for
// links and then fetches every job page's ld+json; this port reads the list
// cards directly to stay zero-extra-request. Live probe 2026-10-21: board
// `cyberagent-group` → 200, 435 postings across 5 pages, no auth.
//
// Auto-detects from `https://hrmos.co/pages/<board>[/jobs...]`. The board is a
// vanity slug or an opaque numeric id; both appear in the wild.

import { decodeEntities } from './_html-entities.mjs';

const HOST = 'hrmos.co';
const BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_MAX_PAGES = 5;
const INTER_PAGE_DELAY_MS = 150;

/**
 * Extract the board slug from an https://hrmos.co/pages/<board>/… URL.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveBoard(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== HOST || u.port) return null;
  const m = /^\/pages\/([^/]+)(?:\/|$)/.exec(u.pathname);
  return m && BOARD_RE.test(m[1]) ? m[1] : null;
}

/** @param {string} url */
function assertHrmosUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`hrmos: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:' || u.hostname !== HOST || u.port) {
    throw new Error(`hrmos: untrusted URL "${url}" — must be https://${HOST}/…`);
  }
  return url;
}

/** @param {string} html */
function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Parse one listing page. Exported for unit tests.
 * Cards without a same-board job link or a title are dropped.
 * @param {string} html
 * @param {string} board
 * @param {string} companyName
 * @returns {{ jobs: Array<{title: string, url: string, company: string, location: string, description?: string}>, total: number | null }}
 */
export function parseHrmosListing(html, board, companyName) {
  const page = String(html || '');
  const totalMatch = /全\s*([\d,]+)\s*件中/.exec(page);
  const total = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null;
  const linkRe = /href="(?:https:\/\/hrmos\.co)?\/pages\/([^"/?#]+)\/jobs\/([^"/?#]+)"/;
  const jobs = [];
  for (const card of page.split(/<li class="pg-list-cassette\b/).slice(1)) {
    const link = linkRe.exec(card);
    if (link && link[1] !== board) continue;
    const title = textOf((/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(card) || [])[1] || '');
    if (!link || !JOB_ID_RE.test(link[2]) || !title) continue;
    const job = {
      title,
      url: `https://${HOST}/pages/${board}/jobs/${link[2]}`,
      company: companyName,
      location: textOf((/<li class="sg-tag-location">([\s\S]*?)<\/li>/.exec(card) || [])[1] || ''),
    };
    const description = textOf((/<span class="pg-list-cassette-body[^"]*">([\s\S]*?)<\/span>/.exec(card) || [])[1] || '');
    if (description) job.description = description;
    jobs.push(job);
  }
  return { jobs, total };
}

/** @type {Provider} */
export default {
  id: 'hrmos',

  detect(entry) {
    const board = resolveBoard(entry);
    return board ? { url: `https://${HOST}/pages/${board}/jobs` } : null;
  },

  async fetch(entry, ctx) {
    const board = resolveBoard(entry);
    if (!board) throw new Error(`hrmos: cannot derive board for ${entry.name}`);
    const maxPages = Math.min(DEFAULT_MAX_PAGES, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
    const sleep = (/** @type {number} */ ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    /** @type {Map<string, any>} */
    const seen = new Map();
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS);
      const url = assertHrmosUrl(`https://${HOST}/pages/${board}/jobs?page=${page}`);
      // redirect:'error' pins the host (SSRF) — see providers/README.md.
      const html = await ctx.fetchText(url, { redirect: 'error' });
      const { jobs, total } = parseHrmosListing(html, board, entry.name);
      const before = seen.size;
      for (const j of jobs) if (!seen.has(j.url)) seen.set(j.url, j);
      if (jobs.length === 0 || seen.size === before) break; // empty or repeated page
      if (total !== null && seen.size >= total) break;
    }
    return [...seen.values()];
  },
};
