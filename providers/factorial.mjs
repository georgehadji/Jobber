// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';

// Factorial (FactorialHR) provider — career sites at <tenant>.factorial.<tld> or
// <tenant>.factorialhr.<tld> (the TLD follows the tenant's country).
// Ported from freehire (github.com/strelov1/freehire,
// internal/ingest/sources/factorial.go, MIT). Live-probed 2026-10-21 with
// boards `highbras.factorialhr.com.br`, `muffin.factorial.it` (200, server-
// rendered list, no auth).
//
// The careers root server-renders one <li class='job-offer-item …
// data-job-postings-url='https://<host>/job_posting/<slug>-<id>' data-is-remote=…>
// per posting with the title in the first font-bold <div>. The list carries no
// place name (location lives on the per-job page, which the zero-token scanner
// skips) so location is "Remote" or empty; no description/date.

// Known country TLDs Factorial serves tenants under. An allowlist (not a
// wildcard) so `evil.factorial.xyz` is rejected.
const TLDS = 'com|es|it|pt|fr|de|mx|co|nl|uk|ch|ie|pl|ro|be|at|cl|pe|ar|br|com\\.br|com\\.mx|com\\.ar|com\\.co|com\\.pe|com\\.es|co\\.uk';
const FACTORIAL_HOST_RE = new RegExp(`^([a-z0-9][a-z0-9-]*)\\.(?:factorial|factorialhr)\\.(?:${TLDS})$`);
const RESERVED = new Set(['www', 'app', 'api', 'help', 'blog', 'support', 'status', 'docs']);
const ID_RE = /-(\d+)\/?$/;

/**
 * Careers host (`<tenant>.factorial.<tld>`) from an entry, or null.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveHost(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const m = FACTORIAL_HOST_RE.exec(u.hostname);
  return m && !RESERVED.has(m[1]) ? u.hostname : null;
}

/** @param {string} s */
function cleanText(s) {
  // Single-pass decode: chained replaces turned `&amp;lt;` into `<` (CodeQL double-unescape).
  return decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse the careers root HTML. Exported for unit tests. Only list items whose
 * posting URL is https, on `host`, under /job_posting/ and ending -<id> are kept
 * (drops the "spontaneous application" item); duplicates collapse by URL.
 * @param {string} html
 * @param {string} host
 * @param {string} companyName
 */
export function parseFactorialListing(html, host, companyName) {
  /** @type {Array<{title: string, url: string, company: string, location: string}>} */
  const out = [];
  const seen = new Set();
  for (const chunk of String(html).split("<li class='job-offer-item").slice(1)) {
    const li = chunk.split('</li>')[0];
    const urlRaw = /data-job-postings-url='([^']+)'/.exec(li)?.[1];
    if (!urlRaw) continue;
    let u;
    try {
      u = new URL(urlRaw.replace(/&amp;/g, '&'));
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' || u.hostname !== host) continue;
    if (!u.pathname.startsWith('/job_posting/') || !ID_RE.test(u.pathname)) continue;
    const url = `https://${host}${u.pathname}`;
    if (seen.has(url)) continue;
    const title = cleanText(/<div[^>]*font-bold[^>]*>([\s\S]*?)<\/div>/.exec(li)?.[1] ?? '');
    if (!title) continue;
    seen.add(url);
    out.push({
      title,
      url,
      company: companyName,
      location: /data-is-remote='true'/.test(li) ? 'Remote' : '',
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'factorial',

  detect(entry) {
    const host = resolveHost(entry);
    return host ? { url: `https://${host}/` } : null;
  },

  async fetch(entry, ctx) {
    const host = resolveHost(entry);
    if (!host) throw new Error(`factorial: cannot derive careers host for ${entry.name}`);
    const html = await ctx.fetchText(`https://${host}/`, { redirect: 'error' });
    return parseFactorialListing(html, host, entry.name);
  },
};
