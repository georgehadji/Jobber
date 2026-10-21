// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// PageUp People provider — multi-tenant ATS (AU/UK/NZ higher-ed and enterprise).
// Provenance: ported from github.com/strelov1/freehire internal/ingest/sources/pageup.go (MIT).
// Live-probed 2026-10-21 on institution 513 (Monash):
//   GET https://careers.pageuppeople.com/513/cw/en/search/?page-items=1000   (header X-Requested-With: XMLHttpRequest)
//   -> 200 JSON {results:"<html fragment>", count:76, ...}, all 76 postings in one response, no auth.
// Without the XHR header the endpoint 302s to the full HTML page, so we send it.
//
// Auto-detects from careers_url `https://careers.pageuppeople.com/<numeric instID>/...`.
// Only the canonical host is supported (vanity hosts sit behind WAFs). The row wrapper
// differs per tenant (<tr> table / <li> / <div>), so parsing keys on the stable
// `a.job-link` anchor and pairs it with the location and summary that follow it. The
// summary is a short teaser (some tenants render none) -> used as `description` when present.
// Salary text is free-form ("HEW 3 ($69,079 - $77,760)") and the posted date is not exposed.

import { decodeEntities } from './_html-entities.mjs';

const HOST = 'careers.pageuppeople.com';
const INST_RE = /^\d{1,9}$/;

/** @param {import('./_types.js').PortalEntry} entry @returns {string | null} numeric institution id */
function resolveInstitution(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== HOST) return null;
  const seg = u.pathname.split('/').filter(Boolean)[0];
  return seg && INST_RE.test(seg) ? seg : null;
}

/** @param {string} inst */
export function searchUrl(inst) {
  return `https://${HOST}/${inst}/cw/en/search/?page-items=1000`;
}

/** @param {string} html */
function text(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const CLS = (/** @type {string} */ name) => `class="(?:[^"]*\\s)?${name}(?:\\s[^"]*)?"`;
const LINK_RE = new RegExp(`<a\\b[^>]*?${CLS('job-link')}[^>]*>([\\s\\S]*?)</a>`, 'gi');
const LOCATION_RE = new RegExp(`<([a-z]+)\\b[^>]*${CLS('location')}[^>]*>([\\s\\S]*?)</\\1>`, 'i');
const SUMMARY_RE = new RegExp(`<(tr|li|div|p|span|td)\\b[^>]*${CLS('(?:jobs-summary|summary)')}[^>]*>([\\s\\S]*?)</\\1>`, 'i');

/**
 * Parse the search-results HTML fragment. Exported for unit tests. Anchors whose href is not
 * `/<inst>/cw/en/job/<id>/...` (nav/back links) are ignored; duplicates collapse on job id.
 * @param {string} fragment
 * @param {string} inst
 * @param {string} companyName
 */
export function parsePageUpListing(fragment, inst, companyName) {
  const html = String(fragment ?? '');
  const hrefRe = new RegExp(`href="(/${inst}/cw/en/job/(\\d+)/[^"#?\\s]*)"`, 'i');
  /** @type {{ index: number, end: number, href: string, id: string, title: string }[]} */
  const anchors = [];
  for (const m of html.matchAll(LINK_RE)) {
    const h = hrefRe.exec(m[0]);
    if (h) anchors.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, href: h[1], id: h[2], title: text(m[1]) });
  }
  const seen = new Set();
  const out = [];
  anchors.forEach((a, i) => {
    if (seen.has(a.id) || !a.title) return;
    seen.add(a.id);
    const seg = html.slice(a.end, anchors[i + 1]?.index ?? html.length);
    const loc = LOCATION_RE.exec(seg);
    const sum = SUMMARY_RE.exec(seg);
    /** @type {import('./_types.js').Job} */
    const job = {
      title: a.title,
      url: `https://${HOST}${a.href}`,
      company: companyName,
      location: loc ? text(loc[2]) : '',
    };
    const description = sum ? text(sum[2]) : '';
    if (description) job.description = description;
    out.push(job);
  });
  return out;
}

/** @type {Provider} */
export default {
  id: 'pageup',

  detect(entry) {
    const inst = resolveInstitution(entry);
    return inst ? { url: searchUrl(inst) } : null;
  },

  async fetch(entry, ctx) {
    const inst = resolveInstitution(entry);
    if (!inst) throw new Error(`pageup: cannot derive institution id for ${entry.name}`);
    const env = /** @type {any} */ (
      await ctx.fetchJson(searchUrl(inst), { redirect: 'error', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    );
    return parsePageUpListing(typeof env?.results === 'string' ? env.results : '', inst, entry.name);
  },
};
