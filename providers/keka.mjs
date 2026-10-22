// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Keka provider — public career-portal job listing API (Indian HR/ATS SaaS).
// Provenance: ported from github.com/strelov1/freehire internal/ingest/sources/keka.go (MIT).
// Live-probed 2026-10-21 against https://minfy.keka.com/careers/api/jobs/default/active
// -> 200, one JSON array holding all 100 open postings with full HTML description, no auth.
//
// Auto-detects from careers_url `https://<tenant>.keka.com[/careers...]`. One request returns
// the whole board (no pagination). `salaryRange` is NOT mapped: live values are placeholders
// (e.g. min 1, salaryPeriod 0), so emitting it would fake comp data.

import { decodeEntities } from './_html-entities.mjs';

const KEKA_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.keka\.com$/;
const RESERVED = new Set(['www', 'app', 'api', 'login', 'help', 'blog', 'careers']);

/** @param {import('./_types.js').PortalEntry} entry @returns {string | null} tenant subdomain */
function resolveTenant(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const m = KEKA_HOST_RE.exec(u.hostname.toLowerCase());
  return m && !RESERVED.has(m[1]) ? m[1] : null;
}

/** @param {string} tenant */
export function baseUrl(tenant) {
  return `https://${tenant}.keka.com/careers`;
}

/** @param {string} html */
function htmlToText(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|h\d|tr)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * Normalize the `jobs/default/active` array. Exported for unit tests.
 * Rows without a numeric id or a title are dropped (the id is the URL / dedup key).
 * @param {any} json
 * @param {string} base  e.g. https://acme.keka.com/careers
 * @param {string} companyName
 */
export function parseKekaJobs(json, base, companyName) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const p of json) {
    const id = Number(p?.id);
    const title = String(p?.title ?? '').trim();
    if (!Number.isInteger(id) || id <= 0 || !title) continue;
    const l = Array.isArray(p.jobLocations) ? p.jobLocations[0] : null;
    const location = l ? [l.city, l.state, l.countryName].filter(Boolean).join(', ') : '';
    /** @type {import('./_types.js').Job} */
    const job = { title, url: `${base}/jobdetails/${id}`, company: companyName, location };
    const description = htmlToText(p.description);
    if (description) job.description = description;
    const ts = Date.parse(p.publishedOn);
    if (Number.isFinite(ts)) job.postedAt = ts;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'keka',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const t = resolveTenant(entry);
    return t ? { url: `${baseUrl(t)}/api/jobs/default/active` } : null;
  },

  async fetch(entry, ctx) {
    const tenant = resolveTenant(entry);
    if (!tenant) throw new Error(`keka: cannot derive tenant for ${entry.name}`);
    const base = baseUrl(tenant);
    const json = await ctx.fetchJson(`${base}/api/jobs/default/active`, { redirect: 'error' });
    return parseKekaJobs(json, base, entry.name);
  },
};
