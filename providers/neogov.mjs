// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// NEOGOV provider — US public-sector career sites on governmentjobs.com and its
// education vertical schooljobs.com (the two are separate tenant spaces). The
// listing is a Knockout SPA whose job cards are served only through an XHR
// partial: the same URL WITHOUT the `X-Requested-With: XMLHttpRequest` header
// returns the empty JS shell. The partial is HTML (`li.list-item` cards, 10 per
// page) carrying title, link, location, a salary line and a teaser snippet. The
// absolute posted date lives only on the detail page (the list shows "Posted N
// weeks ago"), so `postedAt` is omitted.
//
// PROVENANCE: adapted from github.com/strelov1/freehire
// internal/ingest/sources/neogov.go (MIT). The Go adapter also fetches every
// detail page for the full body; this port stays list-only (the teaser snippet
// is the `description`). Live probe 2026-10-21: schooljobs.com/cochisecollege →
// 200, 26 postings over 3 pages; governmentjobs.com/lacounty → 200, 399
// postings; no auth.
//
// Auto-detects from `https://[www.]governmentjobs.com/careers/<agency>[/...]`
// and `https://[www.]schooljobs.com/careers/<agency>[/...]`.
//
// Salary: only a figure explicitly labelled "Annually" is returned; hourly or
// other periods are omitted rather than guessed (annualization rule, _types.js).

import { decodeEntities } from './_html-entities.mjs';

const DOMAINS = new Set(['governmentjobs.com', 'schooljobs.com']);
const AGENCY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
// `/careers/home` is the platform's own landing, never an agency.
const RESERVED_AGENCIES = new Set(['home']);
const JOB_PATH_RE = /^\/careers\/[A-Za-z0-9_-]+\/jobs\/\d+(?:\/[A-Za-z0-9._~%-]*)?$/;
const DEFAULT_MAX_PAGES = 10; // 10 cards per page
const INTER_PAGE_DELAY_MS = 150;
const XHR_HEADERS = { 'X-Requested-With': 'XMLHttpRequest', accept: 'text/html' };
const EMPLOYMENT_RE = /^(full[- ]?time|part[- ]?time|temporary|seasonal|per diem|regular|intern|volunteer|contract|on[- ]call|limited[- ]term)\b/i;
const META_LABEL_RE = /^(category|department|division|exam type|job number|closing)\s*:/i;

/** @param {string} hostname */
function domainOf(hostname) {
  const d = hostname.replace(/^www\./, '');
  return DOMAINS.has(d) ? d : null;
}

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{ domain: string, agency: string } | null}
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
  if (u.protocol !== 'https:' || u.port) return null;
  const domain = domainOf(u.hostname);
  const m = /^\/careers\/([^/]+)(?:\/|$)/.exec(u.pathname);
  if (!domain || !m || !AGENCY_RE.test(m[1]) || RESERVED_AGENCIES.has(m[1].toLowerCase())) return null;
  return { domain, agency: m[1] };
}

/** @param {string} url */
function assertNeogovUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`neogov: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:' || u.port || u.hostname !== `www.${domainOf(u.hostname)}`) {
    throw new Error(`neogov: untrusted URL "${url}" — must be https://www.governmentjobs.com or https://www.schooljobs.com`);
  }
  return url;
}

/** @param {string} html */
function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Annual salary from a card meta line like "Full-time - $50,585.60 - $57,657.60
 * Annually". Returns undefined unless the period is explicitly "Annually".
 * @param {string} line
 * @returns {{min: number | null, max: number | null, currency: string} | undefined}
 */
export function parseAnnualSalary(line) {
  const m = /\$\s*([\d,]+(?:\.\d+)?)(?:\s*-\s*\$\s*([\d,]+(?:\.\d+)?))?\s+Annually\b/i.exec(line);
  if (!m) return undefined;
  const lo = Number(m[1].replace(/,/g, ''));
  const hi = m[2] ? Number(m[2].replace(/,/g, '')) : null;
  if (!Number.isFinite(lo) || lo <= 0) return undefined;
  return { min: lo, max: hi !== null && Number.isFinite(hi) && hi > 0 ? hi : null, currency: 'USD' };
}

/**
 * Parse one XHR listing fragment into Jobs + the open-postings total.
 * Cards without a job id, a recognised job path or a title are dropped.
 * Exported for unit tests.
 * @param {string} fragment
 * @param {string} domain governmentjobs.com | schooljobs.com
 * @param {string} companyName
 * @returns {{ jobs: Array<{title: string, url: string, company: string, location: string, description?: string, salary?: {min: number|null, max: number|null, currency: string}}>, total: number | null }}
 */
export function parseNeogovListing(fragment, domain, companyName) {
  const page = String(fragment || '');
  const totalMatch = /id="job-postings-number">\s*([\d,]+)/.exec(page);
  const total = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null;
  const jobs = [];
  for (const card of page.split(/<li class="list-item"\s+data-job-id="/).slice(1)) {
    const id = /^(\d+)"/.exec(card)?.[1];
    const link = /<a\b[^>]*\bclass="[^"]*\bitem-details-link\b[^"]*"[^>]*>/.exec(card);
    const href = link ? decodeEntities((/\bhref="([^"]*)"/.exec(link[0]) || [])[1] || '') : '';
    const title = link ? textOf(card.slice(link.index + link[0].length).split('</a>')[0]) : '';
    if (!id || !title || !JOB_PATH_RE.test(href)) continue;

    const meta = /<ul class="list-meta">([\s\S]*?)<\/ul>/.exec(card);
    const lines = meta ? [...meta[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1])).filter(Boolean) : [];
    const job = /** @type {any} */ ({
      title,
      url: `https://www.${domain}${href}`,
      company: companyName,
      location: lines.find((l) => !l.includes('$') && !EMPLOYMENT_RE.test(l) && !META_LABEL_RE.test(l)) || '',
    });
    const description = textOf((/<div class="list-entry">([\s\S]*?)<\/div>/.exec(card) || [])[1] || '');
    if (description) job.description = description;
    const salary = lines.map(parseAnnualSalary).find(Boolean);
    if (salary) job.salary = salary;
    jobs.push(job);
  }
  return { jobs, total };
}

/** @type {Provider} */
export default {
  id: 'neogov',

  detect(entry) {
    const b = resolveBoard(entry);
    return b ? { url: `https://www.${b.domain}/careers/${b.agency}` } : null;
  },

  async fetch(entry, ctx) {
    const b = resolveBoard(entry);
    if (!b) throw new Error(`neogov: cannot derive agency for ${entry.name}`);
    const maxPages = Math.min(DEFAULT_MAX_PAGES, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);
    const sleep = (/** @type {number} */ ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

    /** @type {Map<string, any>} */
    const seen = new Map();
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS);
      const url = assertNeogovUrl(
        `https://www.${b.domain}/careers/home/index?agency=${encodeURIComponent(b.agency)}&sort=PositionTitle&isDescendingSort=false&page=${page}`,
      );
      const html = await ctx.fetchText(url, { redirect: 'error', headers: XHR_HEADERS });
      const { jobs, total } = parseNeogovListing(html, b.domain, entry.name);
      const before = seen.size;
      for (const j of jobs) if (!seen.has(j.url)) seen.set(j.url, j);
      if (jobs.length === 0 || seen.size === before) break; // empty or repeated page
      if (total !== null && seen.size >= total) break;
    }
    return [...seen.values()];
  },
};
