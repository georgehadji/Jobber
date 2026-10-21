// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// JazzHR provider — public per-tenant career page `https://<tenant>.applytojob.com/apply`.
// Ported from github.com/strelov1/freehire internal/ingest/sources/jazzhr.go (MIT).
// Live-probed 2026-10-21 against https://proautomated.applytojob.com/apply (200,
// 29 server-rendered postings, no auth, no pagination).
//
// The listing is one server-rendered page linking every open posting:
//   <li class="list-group-item"><h3 class='list-group-item-heading'>
//     <a href="https://<tenant>.applytojob.com/apply/<token>/<Slug>">Title</a></h3>
//     <ul class='list-inline list-group-item-text'><li><i class='fa fa-map-marker'></i>City, ST</li>…
// freehire fetches every job page for ld+json (description/date); Jobber's scanner
// is zero-token/list-only, so description and postedAt are omitted.

import { decodeEntities } from './_html-entities.mjs';

const JAZZHR_HOST_RE = /^[a-z0-9][a-z0-9-]*\.applytojob\.com$/;
const JOB_HREF_RE = /\/apply\/([A-Za-z0-9]+)\//;

/**
 * Tenant origin from entry.api / entry.careers_url, or null if not a JazzHR host.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveOrigin(entry) {
  const raw = String((typeof entry?.api === 'string' && entry.api) || (typeof entry?.careers_url === 'string' && entry.careers_url) || '').trim();
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !JAZZHR_HOST_RE.test(u.hostname)) return null;
  return `https://${u.hostname}`;
}

/** @param {string} s */
const clean = (s) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Parse the /apply listing HTML. Exported for unit tests.
 * Rows are keyed by the /apply/<token>/ href; location is the map-marker <li>
 * between this anchor and the next posting anchor. Hrefs off the tenant host
 * and rows without a title are dropped.
 *
 * @param {string} html
 * @param {string} origin e.g. "https://acme.applytojob.com"
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseJazzHRListing(html, origin, companyName) {
  if (typeof html !== 'string') return [];
  const host = new URL(origin).hostname;
  const anchors = [...html.matchAll(/<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ m, href: decodeEntities(m[1]) }))
    .filter(({ href }) => JOB_HREF_RE.test(href));
  const out = [];
  const seen = new Set();
  anchors.forEach(({ m, href }, i) => {
    const token = /** @type {RegExpMatchArray} */ (href.match(JOB_HREF_RE))[1];
    const title = clean(m[2]);
    if (!title || seen.has(token)) return;
    let url;
    try {
      const u = new URL(href, origin);
      if (u.protocol !== 'https:' || u.hostname !== host) return;
      url = u.href;
    } catch {
      return;
    }
    seen.add(token);
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < anchors.length ? anchors[i + 1].m.index : html.length;
    const seg = html.slice(start, end);
    const loc = seg.match(/fa-map-marker[^>]*>\s*(?:<\/i>)?([\s\S]*?)<\/li>/i);
    out.push({ title, url, company: companyName, location: loc ? clean(loc[1]) : '' });
  });
  return out;
}

/** @type {Provider} */
export default {
  id: 'jazzhr',

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}/apply` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`jazzhr: cannot derive <tenant>.applytojob.com URL for ${entry.name}`);
    // redirect:'error' keeps the final host pinned to the validated tenant (SSRF).
    const html = await ctx.fetchText(`${origin}/apply`, { redirect: 'error' });
    return parseJazzHRListing(html, origin, entry.name);
  },
};
