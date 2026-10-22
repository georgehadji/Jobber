// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// PeopleForce provider — server-rendered career sites at <tenant>.peopleforce.io.
// Provenance: ported from github.com/strelov1/freehire internal/ingest/sources/peopleforce.go (MIT).
// Live-probed 2026-10-21 on https://gigacloud.peopleforce.io/careers?page=1 -> 200 HTML, no auth.
//
// Auto-detects from careers_url `https://<tenant>.peopleforce.io[/careers...]`. The listing is
// paginated via ?page=N (10 cards/page); each card links to /careers/v/<id>-<slug> and shows
// department, work type and location inline, so no per-job detail request is made and
// `description` / `postedAt` are omitted (the detail page carries neither a date nor JSON-LD).
// An out-of-range ?page=N is CLAMPED to the last real page (not served empty), so the walk
// ends when the page's own pagination nav names no page after the current one.

import { decodeEntities } from './_html-entities.mjs';

const HOST_RE = /^([a-z0-9][a-z0-9-]*)\.peopleforce\.io$/;
const RESERVED = new Set(['www', 'app', 'api', 'help', 'login', 'blog', 'status']);
const DEFAULT_MAX_PAGES = 10;
const PAGE_DELAY_MS = 400; // peopleforce.io 429s on bursts

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
  const m = HOST_RE.exec(u.hostname.toLowerCase());
  return m && !RESERVED.has(m[1]) ? m[1] : null;
}

/** @param {string} tenant @param {number} page */
export function listUrl(tenant, page) {
  return `https://${tenant}.peopleforce.io/careers?page=${page}`;
}

/** @param {string} html */
function text(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const ANCHOR_RE = /<a\b[^>]*\bhref="([^"]*\/careers\/v\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Parse one listing page. Exported for unit tests. Only same-tenant `/careers/v/<id>` links
 * count; duplicates collapse on job id; blank titles are dropped.
 * @param {string} html
 * @param {string} tenant
 * @param {string} companyName
 */
export function parsePeopleForceListing(html, tenant, companyName) {
  const src = String(html ?? '');
  const base = new URL(`https://${tenant}.peopleforce.io/careers`);
  /** @type {{ index: number, end: number, url: string, id: string, title: string }[]} */
  const anchors = [];
  for (const m of src.matchAll(ANCHOR_RE)) {
    let u;
    try {
      u = new URL(decodeEntities(m[1]), base);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' || u.hostname !== base.hostname) continue;
    const idm = /^\/careers\/v\/(\d+)(?:-[^/?#]*)?$/.exec(u.pathname);
    if (!idm) continue;
    anchors.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, url: `${u.origin}${u.pathname}`, id: idm[1], title: text(m[3]) });
  }
  const seen = new Set();
  const out = [];
  anchors.forEach((a, i) => {
    if (seen.has(a.id) || !a.title) return;
    seen.add(a.id);
    const seg = src.slice(a.end, anchors[i + 1]?.index ?? src.length);
    const loc = /fa-map-marker-alt[^>]*><\/i>\s*([^<]*)/i.exec(seg);
    out.push({ title: a.title, url: a.url, company: companyName, location: loc ? text(loc[1]) : '' });
  });
  return out;
}

/** True when the page's pagination nav links to a page numbered above `current`. @param {string} html @param {number} current */
export function hasPageAfter(html, current) {
  for (const m of String(html ?? '').matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)) {
    const n = /[?&]page=(\d+)/.exec(m[1]);
    if (n && Number(n[1]) > current) return true;
  }
  return false;
}

/** @type {Provider} */
export default {
  id: 'peopleforce',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const t = resolveTenant(entry);
    return t ? { url: listUrl(t, 1) } : null;
  },

  async fetch(entry, ctx) {
    const tenant = resolveTenant(entry);
    if (!tenant) throw new Error(`peopleforce: cannot derive tenant for ${entry.name}`);
    const maxPages = ctx.maxPages && ctx.maxPages > 0 ? ctx.maxPages : Math.min(Number(entry.max_pages) || DEFAULT_MAX_PAGES, 100);
    const sleep = ctx.sleep ?? ((/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms)));
    /** @type {import('./_types.js').Job[]} */
    const jobs = [];
    const seen = new Set();
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(PAGE_DELAY_MS);
      const html = await ctx.fetchText(listUrl(tenant, page), { redirect: 'error' });
      const cards = parsePeopleForceListing(html, tenant, entry.name);
      for (const j of cards) {
        if (!seen.has(j.url)) {
          seen.add(j.url);
          jobs.push(j);
        }
      }
      if (cards.length === 0 || !hasPageAfter(html, page)) break;
    }
    return jobs;
  },
};
