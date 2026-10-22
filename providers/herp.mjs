// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// HERP provider — Japanese ATS career pages (herp.careers). The server-rendered
// board page `https://herp.careers/v1/<board>` links either straight to job
// postings (`/v1/<board>/<jobId>`) or to "requisition groups"
// (`/v1/<board>/requisition-groups/<uuid>`), which are one more listing page of
// the same shape. List cards carry the posting title but no location, so
// `location` is '' and no per-job detail request is made.
//
// PROVENANCE: adapted from github.com/strelov1/freehire
// internal/ingest/sources/herp.go (MIT). The Go adapter fetches every job page
// for its ld+json; this port stays list-only (zero extra requests). Live probe
// 2026-10-21: board `a244` → 200, 15 postings + 3 requisition groups, no auth.
//
// Auto-detects from `https://herp.careers/v1/<board>[/...]`.

import { decodeEntities } from './_html-entities.mjs';

const HOST = 'herp.careers';
const BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const GROUP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Single-segment paths under /v1/<board>/ that are platform machinery, not jobs
// (freehire herpNonJobSegments: the board's optional landing page).
const NON_JOB_SEGMENTS = new Set(['top', 'requisition-groups']);
const DEFAULT_MAX_PAGES = 5;
const INTER_PAGE_DELAY_MS = 150;

/**
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
  const m = /^\/v1\/([^/]+)(?:\/|$)/.exec(u.pathname);
  return m && BOARD_RE.test(m[1]) ? m[1] : null;
}

/** @param {string} url */
function assertHerpUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`herp: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:' || u.hostname !== HOST || u.port) {
    throw new Error(`herp: untrusted URL "${url}" — must be https://${HOST}/…`);
  }
  return url;
}

/** @param {string} html */
function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Parse a HERP board or requisition-group page. Exported for unit tests.
 * Only anchors rooted at exactly `/v1/<board>/` count (a share-widget link has
 * its own host, so it never matches even when its query embeds a HERP URL).
 * @param {string} html
 * @param {string} board
 * @param {string} companyName
 * @returns {{ jobs: Array<{title: string, url: string, company: string, location: string}>, groups: string[] }}
 */
export function parseHerpListing(html, board, companyName) {
  /** @type {Map<string, string>} */
  const titles = new Map(); // job id -> best title seen
  const groups = new Set();
  const anchorRe = /<a\b[^>]*?\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const prefix = `/v1/${board}/`;
  let m;
  while ((m = anchorRe.exec(String(html || '')))) {
    let path = decodeEntities(m[1]);
    if (path.startsWith(`https://${HOST}/`)) path = path.slice(`https://${HOST}`.length);
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const group = /^requisition-groups\/([^/?#]+)$/.exec(rest);
    if (group) {
      if (GROUP_ID_RE.test(group[1])) groups.add(group[1]);
      continue;
    }
    if (!ID_RE.test(rest) || NON_JOB_SEGMENTS.has(rest)) continue; // also rejects /<id>/apply
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(m[2]);
    const title = textOf(h2 ? h2[1] : m[2]);
    if (!titles.has(rest) || (!titles.get(rest) && title)) titles.set(rest, title);
  }
  const jobs = [...titles]
    .filter(([, title]) => title)
    .map(([id, title]) => ({ title, url: `https://${HOST}/v1/${board}/${id}`, company: companyName, location: '' }));
  return { jobs, groups: [...groups] };
}

/** @type {Provider} */
export default {
  id: 'herp',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const board = resolveBoard(entry);
    return board ? { url: `https://${HOST}/v1/${board}` } : null;
  },

  async fetch(entry, ctx) {
    const board = resolveBoard(entry);
    if (!board) throw new Error(`herp: cannot derive board for ${entry.name}`);
    const maxPages = Math.min(DEFAULT_MAX_PAGES, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
    const sleep = (/** @type {number} */ ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    const get = async (/** @type {string} */ url) => ctx.fetchText(assertHerpUrl(url), { redirect: 'error' });
    const root = parseHerpListing(await get(`https://${HOST}/v1/${board}`), board, entry.name);
    /** @type {Map<string, any>} */
    const seen = new Map(root.jobs.map((j) => [j.url, j]));
    for (const gid of root.groups.slice(0, maxPages - 1)) {
      await sleep(INTER_PAGE_DELAY_MS);
      const g = parseHerpListing(await get(`https://${HOST}/v1/${board}/requisition-groups/${gid}`), board, entry.name);
      for (const j of g.jobs) if (!seen.has(j.url)) seen.set(j.url, j);
    }
    return [...seen.values()];
  },
};
