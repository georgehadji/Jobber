// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Hireology provider — public JSON:API behind careers.hireology.com/<slug>.
// Ported from github.com/strelov1/freehire internal/ingest/sources/hireology.go (MIT).
// Live-probed 2026-10-21 against https://api.hireology.com/v1/careers/visitingangels
// (200, 213 postings with the description inline, no auth).
//
//   GET https://api.hireology.com/v1/careers/<slug>
//   → { data: [{ id, attributes: { name, remote, "job-description" (HTML),
//        locations: ["City, ST"], status: "Open", "career-site-url" } }] }
// Single request, no pagination. The API carries no posting date.

import { decodeEntities } from './_html-entities.mjs';

const CAREERS_HOST = 'careers.hireology.com';
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Board slug from entry.careers_url (https://careers.hireology.com/<slug>[/...]).
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveSlug(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== CAREERS_HOST) return null;
  const slug = u.pathname.split('/').filter(Boolean)[0];
  return slug && SLUG_RE.test(slug) ? slug : null;
}

/** @param {string} html */
function htmlToText(html) {
  const withBreaks = String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|div|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(withBreaks)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse an api.hireology.com careers response. Exported for unit tests.
 * Only status "Open" rows with an id and a name are kept. `career-site-url`
 * is used only when it is an https careers.hireology.com URL, else the
 * canonical /<slug>/<id>/description URL is built.
 *
 * @param {any} json
 * @param {string} slug
 * @param {string} companyName
 * @returns {import('./_types.js').Job[]}
 */
export function parseHireologyResponse(json, slug, companyName) {
  const rows = json?.data;
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const d of rows) {
    const a = d?.attributes;
    const id = String(d?.id ?? '').trim();
    if (!a || !id || String(a.status ?? '').toLowerCase() !== 'open') continue;
    const title = String(a.name ?? '').trim();
    if (!title) continue;
    let url = `https://${CAREERS_HOST}/${slug}/${encodeURIComponent(id)}/description`;
    try {
      const u = new URL(String(a['career-site-url'] ?? ''));
      if (u.protocol === 'https:' && u.hostname === CAREERS_HOST) url = u.href;
    } catch { /* keep canonical url */ }
    const parts = (Array.isArray(a.locations) ? a.locations : []).map((l) => String(l ?? '').trim()).filter(Boolean);
    if (a.remote === true && !parts.some((p) => /remote/i.test(p))) parts.push('Remote');
    /** @type {import('./_types.js').Job} */
    const job = { title, url, company: companyName, location: parts.join('; ') };
    const description = a['job-description'] ? htmlToText(a['job-description']) : '';
    if (description) job.description = description;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'hireology',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const slug = resolveSlug(entry);
    return slug ? { url: `https://api.hireology.com/v1/careers/${slug}` } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`hireology: cannot derive board slug from careers_url for ${entry.name}`);
    const json = await ctx.fetchJson(`https://api.hireology.com/v1/careers/${slug}`, { redirect: 'error' });
    return parseHireologyResponse(json, slug, entry.name);
  },
};
