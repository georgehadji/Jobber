// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Trakstar Hire (formerly Recruiterbox) provider — the public per-tenant RSS feed
// `https://<board>.hire.trakstar.com/jobfeeds/<board>`. One GET returns every open
// position with the HTML body inline (no pagination, no detail request), parsed
// in-process (same approach as larajobs.mjs).
// Provenance: github.com/strelov1/freehire internal/ingest/sources/trakstar.go (MIT).
// Live-probed 2026-10-21 on https://cheesecakelabs.hire.trakstar.com/jobfeeds/cheesecakelabs (2 items).

import { decodeEntities } from './_html-entities.mjs';

const HOST_RE = /^[a-z0-9][a-z0-9-]*\.hire\.trakstar\.com$/;

/** @param {unknown} raw @returns {string | null} board (tenant subdomain) */
function boardFrom(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !HOST_RE.test(u.hostname)) return null;
  return u.hostname.split('.')[0];
}

/** @param {string} url */
function assertTrakstarUrl(url) {
  if (!boardFrom(url)) throw new Error(`trakstar: untrusted or non-HTTPS URL "${url}" — must be https://<board>.hire.trakstar.com`);
  return url;
}

function fromCodePoint(cp) {
  try { return String.fromCodePoint(cp); } catch { return ''; }
}

// Resolve an XML tag's inner text: unwrap CDATA, else decode the XML entities.
// &amp; is decoded LAST so a literal "&amp;lt;" yields "&lt;" (no over-decoding).
function xmlText(inner) {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(inner);
  if (cdata) return cdata[1].trim();
  return inner
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function tagText(block, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return m ? xmlText(m[1]) : '';
}

/** HTML body (already XML-unescaped) → readable plain text. */
function htmlToText(html) {
  return decodeEntities(
    html.replace(/<(?:br|\/p|\/li|\/h[1-6]|\/div)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' '),
  ).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parse a Trakstar Hire RSS feed. Exported for unit tests.
 * @param {string} xml
 * @param {string} company fallback company (entry.name)
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>}
 */
export function parseTrakstarFeed(xml, company) {
  if (typeof xml !== 'string') return [];
  const jobs = [];
  for (const item of xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || []) {
    const title = tagText(item, 'title');
    let url = '';
    try {
      const u = new URL(tagText(item, 'link'));
      if ((u.protocol === 'http:' || u.protocol === 'https:') && HOST_RE.test(u.hostname)) {
        u.protocol = 'https:';
        url = u.href;
      }
    } catch { /* unusable link → dropped below */ }
    if (!title || !url) continue;
    const job = {
      title,
      url,
      company,
      location: ['job:locationCity', 'job:locationState', 'job:locationCountry'].map((t) => tagText(item, t)).filter(Boolean).join(', '),
    };
    const description = htmlToText(tagText(item, 'description'));
    if (description) /** @type {any} */ (job).description = description;
    const postedAt = Date.parse(tagText(item, 'pubDate'));
    if (!Number.isNaN(postedAt)) /** @type {any} */ (job).postedAt = postedAt;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'trakstar',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const board = boardFrom(entry?.careers_url);
    return board ? { url: `https://${board}.hire.trakstar.com/jobfeeds/${board}` } : null;
  },

  async fetch(entry, ctx) {
    const board = boardFrom(entry?.careers_url);
    if (!board) throw new Error(`trakstar: cannot derive board for ${entry?.name}`);
    const url = assertTrakstarUrl(`https://${board}.hire.trakstar.com/jobfeeds/${board}`);
    // redirect:'error' + the host check keep the request pinned to the tenant (SSRF).
    const xml = await ctx.fetchText(url, { redirect: 'error' });
    return parseTrakstarFeed(xml, entry.name);
  },
};
