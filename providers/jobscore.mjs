// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// JobScore provider — the public per-company JSON feed
// `https://careers.jobscore.com/jobs/<slug>/feed.json`. One call returns every published
// posting with structured location, remote string, opened_date and the HTML description,
// so no detail request is needed. (JobScore asks integrations to poll a feed at most hourly.)
// Provenance: github.com/strelov1/freehire internal/ingest/sources/jobscore.go (MIT).
// Live-probed 2026-10-21 on https://careers.jobscore.com/careers/ierustechnologiesinc (feed.json 200).
// Auto-detects `https://careers.jobscore.com/careers/<slug>[/...]` (the board slug is a path
// segment on one shared host, so the host is a static pin and the slug is regex-validated).

import { decodeEntities } from './_html-entities.mjs';

const HOST = 'careers.jobscore.com';
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const LIMIT = 1000;

/** @param {unknown} raw @returns {string | null} board slug */
function slugFrom(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== HOST) return null;
  const m = /^\/(?:careers|jobs)\/([^/]+)/.exec(u.pathname);
  return m && SLUG_RE.test(m[1]) ? m[1] : null;
}

/** @param {string} url */
function assertJobScoreUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`jobscore: invalid URL: ${url}`); }
  if (u.protocol !== 'https:') throw new Error(`jobscore: URL must use HTTPS: ${url}`);
  if (u.hostname !== HOST) throw new Error(`jobscore: untrusted hostname "${u.hostname}" — must be ${HOST}`);
  return url;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** HTML description → plain text. */
function htmlToText(html) {
  return decodeEntities(
    html.replace(/<(?:br|\/p|\/li|\/h[1-6]|\/div)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' '),
  ).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Keep detail_url only when it is an https link on the pinned host; drop the tracking query. */
function cleanDetailUrl(v) {
  try {
    const u = new URL(str(v));
    if (u.protocol !== 'https:' || u.hostname !== HOST) return '';
    u.search = '';
    u.hash = '';
    return u.href;
  } catch { return ''; }
}

/**
 * Parse a JobScore feed.json payload. Exported for unit tests.
 * @param {any} json
 * @param {string} slug board slug (used to rebuild a URL when detail_url is unusable)
 * @param {string} company fallback company (entry.name)
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>}
 */
export function parseJobScoreFeed(json, slug, company) {
  const rows = json?.jobs;
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const j of rows) {
    const id = str(j?.id);
    const title = str(j?.title);
    if (!id || !title) continue;
    const url = cleanDetailUrl(j.detail_url) || `https://${HOST}/careers/${slug}/jobs/${encodeURIComponent(id)}`;
    const place = [str(j.city), str(j.state)].filter(Boolean).join(', ') || str(j.country) || str(j.location);
    const remote = /^yes\b/i.test(str(j.remote)) && !/some/i.test(str(j.remote)) ? 'Remote' : '';
    const job = {
      title,
      url,
      company: str(company) || str(j.company_name) || str(json.company_name),
      location: [place, remote].filter(Boolean).join(', '),
    };
    const description = typeof j.description === 'string' ? htmlToText(j.description) : '';
    if (description) /** @type {any} */ (job).description = description;
    const postedAt = Date.parse(str(j.opened_date));
    if (!Number.isNaN(postedAt)) /** @type {any} */ (job).postedAt = postedAt;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'jobscore',

  detect(entry) {
    const slug = slugFrom(entry?.careers_url);
    return slug ? { url: `https://${HOST}/jobs/${slug}/feed.json` } : null;
  },

  async fetch(entry, ctx) {
    const slug = slugFrom(entry?.careers_url);
    if (!slug) throw new Error(`jobscore: cannot derive board slug for ${entry?.name}`);
    const url = assertJobScoreUrl(`https://${HOST}/jobs/${slug}/feed.json?sort=date&limit=${LIMIT}`);
    // redirect:'error' + the host pin keep the request on careers.jobscore.com (SSRF).
    const json = await ctx.fetchJson(url, { redirect: 'error' });
    return parseJobScoreFeed(json, slug, entry.name);
  },
};
