// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { decodeEntities } from './_html-entities.mjs';

// Paycor Recruiting provider — recruitingbypaycor.com career listing (server-
// rendered HTML, keyless, no pagination: one page lists the whole board).
// Provenance: github.com/strelov1/freehire internal/ingest/sources/paycor.go (MIT).
// Live-probed 2026-10-21 against clientId=8a7883c664f8df9e0165119e33353606
// (HTTP 200, 4 postings with title + location in the listing).
//
// Auto-detects from `https://recruitingbypaycor.com/career/...?clientId=<32 hex>`.
// The host is fixed, so SSRF defence is an exact-host check plus the 32-hex
// clientId charset. freehire fetches every posting page for its fields; the
// zero-token scanner reads title (link text) and location (the sibling
// description cell) straight off the listing instead. A listing template that
// renders no link text yields no rows for it (dropped, never guessed). The
// board states no posting date and the description lives on the posting page,
// so both are omitted.

const PAYCOR_HOST = 'recruitingbypaycor.com';
const CAREER_BASE = `https://${PAYCOR_HOST}/career`;
const CLIENT_ID_RE = /^[0-9a-f]{32}$/i;
const POSTING_ID_RE = /^[A-Za-z0-9]{8,64}$/;
const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const LOCATION_CELL_RE = /gnewtonCareerGroupJobDescriptionClass[^>]*>([\s\S]*?)<\/div>/i;

/**
 * Board clientId from a Paycor career URL; null if not one.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function parsePaycorClientId(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== PAYCOR_HOST) return null;
  const id = u.searchParams.get('clientId') ?? '';
  return CLIENT_ID_RE.test(id) ? id.toLowerCase() : null;
}

/** @param {string} url */
function assertPaycorUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`paycor: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:') throw new Error(`paycor: URL must use HTTPS: ${url}`);
  if (u.hostname !== PAYCOR_HOST) throw new Error(`paycor: untrusted hostname "${u.hostname}" — must be ${PAYCOR_HOST}`);
  return url;
}

/** @param {string} clientId */
const listingUrl = clientId => assertPaycorUrl(`${CAREER_BASE}/CareerHome.action?clientId=${clientId}`);

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[\s ]+/g, ' ').trim();
}

/**
 * Parse a CareerHome.action listing. Exported for unit tests.
 * Only anchors to JobIntroduction.action on THIS clientId count (a themed
 * listing embeds other links); duplicate posting ids collapse to the first.
 * The canonical URL is rebuilt from the ids, dropping tracking params.
 * @param {string} html
 * @param {string} clientId lower-case 32-hex board id
 * @param {string} companyName
 * @returns {import('./_types.js').Job[]}
 */
export function parsePaycorListing(html, clientId, companyName) {
  if (typeof html !== 'string') return [];
  const anchors = [...html.matchAll(ANCHOR_RE)].filter(m => /JobIntroduction\.action/.test(m[1]));
  /** @type {import('./_types.js').Job[]} */
  const out = [];
  const seen = new Set();
  for (const m of anchors) {
    const href = /href\s*=\s*"([^"]*)"/i.exec(m[1])?.[1];
    if (!href) continue;
    let u;
    try {
      u = new URL(decodeEntities(href), `${CAREER_BASE}/`);
    } catch {
      continue;
    }
    if (u.hostname !== PAYCOR_HOST || !u.pathname.endsWith('/JobIntroduction.action')) continue;
    if ((u.searchParams.get('clientId') ?? '').toLowerCase() !== clientId) continue;
    const id = u.searchParams.get('id') ?? '';
    const title = clean(m[2]);
    if (!POSTING_ID_RE.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    // Location cell sits between this anchor and the next one.
    const next = anchors[anchors.indexOf(m) + 1]?.index ?? html.length;
    const segment = html.slice((m.index ?? 0) + m[0].length, next);
    const location = clean(LOCATION_CELL_RE.exec(segment)?.[1] ?? '');
    out.push({
      title,
      url: `${CAREER_BASE}/JobIntroduction.action?clientId=${clientId}&id=${id}`,
      company: companyName,
      location,
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'paycor',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const clientId = parsePaycorClientId(entry.careers_url);
    return clientId ? { url: listingUrl(clientId) } : null;
  },

  async fetch(entry, ctx) {
    const clientId = parsePaycorClientId(entry.careers_url);
    if (!clientId) throw new Error(`paycor: cannot derive clientId for ${entry.name}`);
    const html = await ctx.fetchText(listingUrl(clientId), { redirect: 'error' });
    return parsePaycorListing(html, clientId, entry.name);
  },
};
