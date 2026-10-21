// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Eightfold AI career-site provider — public list API, two generations.
// Provenance: ported from github.com/strelov1/freehire internal/ingest/sources/eightfold.go (MIT).
// Live-probed 2026-10-21 (both unauthenticated, 10 positions/page):
//   pcsx   GET https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=&start=0&num=10&sort_by=relevance
//          -> 200 {data:{positions[],count:2418}}   (positionUrl, postedTs, locations[], workLocationOption)
//   legacy GET https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&query=&start=0&num=10&sort_by=relevance
//          -> 200 {positions[],count:382}            (canonicalPositionUrl, t_create, location, work_location_option)
// A tenant answers exactly one generation (the other returns 403), so we try pcsx first and
// fall back to the legacy list. The list carries no description (it needs one detail request
// per job, and Eightfold rate-limits ~290 requests/window), so `description` is omitted.
//
// Eightfold tenants live on arbitrary vanity hosts and need a "domain" key, so:
//   - auto-detect only claims `https://<tenant>.eightfold.ai/...`;
//   - a vanity host needs explicit `provider: eightfold` (same convention as avature.mjs);
//   - `domain: <key>` on the entry pins the tenant key; otherwise it is read once from the
//     careers page (`"domain": "microsoft.com"`, HTML-entity encoded in a data attribute).
// Because a vanity host cannot be allowlisted, explicit-provider hosts must be public DNS
// names over https (no IP literal, no localhost/.local/.internal, no port, no userinfo).

import { decodeEntities } from './_html-entities.mjs';

const EIGHTFOLD_HOST_RE = /^[a-z0-9][a-z0-9-]*\.eightfold\.ai$/;
const PUBLIC_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z][a-z0-9-]*[a-z0-9]$/;
const BLOCKED_SUFFIX_RE = /\.(local|localhost|internal|lan|home|corp|test|invalid)$/;
const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
const PAGE_SIZE = 10; // server-capped regardless of `num`
const DEFAULT_MAX_PAGES = 10;
const PAGE_DELAY_MS = 350;
const RATE_LIMIT_RETRIES = 3;

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{ host: string, domain: string | null } | null}
 */
function resolveTarget(entry) {
  const raw = (typeof entry.careers_url === 'string' && entry.careers_url.trim()) || (typeof entry.api === 'string' ? entry.api.trim() : '');
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const eightfoldHost = EIGHTFOLD_HOST_RE.test(host);
  const explicit = entry.provider === 'eightfold' && PUBLIC_HOST_RE.test(host) && !BLOCKED_SUFFIX_RE.test(host);
  if (!eightfoldHost && !explicit) return null;
  const domain = typeof entry.domain === 'string' && DOMAIN_RE.test(entry.domain.trim()) ? entry.domain.trim().toLowerCase() : null;
  return { host, domain };
}

/** Read the tenant "domain" key out of the careers page. Exported for unit tests. @param {string} html */
export function parseDomainFromPage(html) {
  const m = /(?:&#34;|&quot;|")domain(?:&#34;|&quot;|")\s*:\s*(?:&#34;|&quot;|")([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?:&#34;|&quot;|")/i.exec(String(html ?? ''));
  return m ? m[1].toLowerCase() : null;
}

/**
 * @param {string} host @param {string} domain @param {'pcsx' | 'v2'} gen @param {number} start
 */
export function listUrl(host, domain, gen, start) {
  const path = gen === 'pcsx' ? '/api/pcsx/search' : '/api/apply/v2/jobs';
  return `https://${host}${path}?domain=${encodeURIComponent(domain)}&query=&start=${start}&num=${PAGE_SIZE}&sort_by=relevance`;
}

/**
 * Normalize one list page of either generation. Exported for unit tests.
 * Rows without a numeric id or a title are dropped (id is the URL / dedup key).
 * @param {any} json
 * @param {'pcsx' | 'v2'} gen
 * @param {string} host
 * @param {string} companyName
 * @returns {{ jobs: import('./_types.js').Job[], count: number, rows: number }}
 */
export function parseEightfoldPage(json, gen, host, companyName) {
  const body = gen === 'pcsx' ? json?.data : json;
  const rows = Array.isArray(body?.positions) ? body.positions : [];
  const count = Number(body?.count) || 0;
  /** @type {import('./_types.js').Job[]} */
  const jobs = [];
  for (const p of rows) {
    const id = String(p?.id ?? '');
    const title = String(p?.name ?? '').trim();
    if (!/^\d+$/.test(id) || !title) continue;
    const locs = Array.isArray(p.locations) ? p.locations.filter(Boolean) : [];
    let location = String(p.location || locs.join('; ') || '').trim();
    const mode = String(p.workLocationOption ?? p.work_location_option ?? '').toLowerCase();
    if (mode === 'remote' && !/remote/i.test(location)) location = [location, 'Remote'].filter(Boolean).join(', ');
    /** @type {import('./_types.js').Job} */
    const job = { title, url: `https://${host}/careers/job/${id}`, company: companyName, location };
    const secs = Number(gen === 'pcsx' ? p.postedTs : p.t_create);
    if (Number.isFinite(secs) && secs > 0) job.postedAt = secs * 1000;
    jobs.push(job);
  }
  return { jobs, count, rows: rows.length };
}

/** @type {Provider} */
export default {
  id: 'eightfold',

  detect(entry) {
    const t = resolveTarget(entry);
    return t ? { url: `https://${t.host}/careers` } : null;
  },

  async fetch(entry, ctx) {
    const target = resolveTarget(entry);
    if (!target) throw new Error(`eightfold: cannot derive tenant host for ${entry.name}`);
    const { host } = target;
    const sleep = ctx.sleep ?? ((/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms)));
    const maxPages = ctx.maxPages && ctx.maxPages > 0 ? ctx.maxPages : Math.min(Number(entry.max_pages) || DEFAULT_MAX_PAGES, 200);

    let domain = target.domain;
    if (!domain) {
      domain = parseDomainFromPage(await ctx.fetchText(`https://${host}/careers`, { redirect: 'error' }));
      if (!domain) throw new Error(`eightfold: tenant domain not found on https://${host}/careers (set "domain:" on the entry)`);
    }

    /** Rate-limited (429) requests are retried with backoff; every other error propagates. @param {string} url */
    const getJson = async url => {
      for (let attempt = 0; ; attempt++) {
        try {
          return /** @type {any} */ (await ctx.fetchJson(url, { redirect: 'error' }));
        } catch (e) {
          if (/** @type {any} */ (e)?.status !== 429 || attempt >= RATE_LIMIT_RETRIES) throw e;
          await sleep(2000 * (attempt + 1));
        }
      }
    };

    /** @type {'pcsx' | 'v2'} */
    let gen = 'pcsx';
    /** @type {any} */
    let first;
    try {
      first = await getJson(listUrl(host, domain, 'pcsx', 0));
    } catch (e) {
      if (/** @type {any} */ (e)?.status !== 403) throw e;
      gen = 'v2'; // tenant is on the legacy list API
      first = await getJson(listUrl(host, domain, 'v2', 0));
    }

    /** @type {import('./_types.js').Job[]} */
    const jobs = [];
    let page = parseEightfoldPage(first, gen, host, entry.name);
    let start = 0;
    for (let n = 1; ; n++) {
      jobs.push(...page.jobs);
      start += page.rows;
      if (page.rows === 0 || start >= page.count || n >= maxPages) break;
      await sleep(PAGE_DELAY_MS);
      page = parseEightfoldPage(await getJson(listUrl(host, domain, gen, start)), gen, host, entry.name);
    }
    return jobs;
  },
};
