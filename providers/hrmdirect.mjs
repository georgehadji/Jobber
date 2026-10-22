// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// HRM Direct (ClearCompany) provider — public per-tenant career site
// `https://<tenant>.hrmdirect.com/employment/job-openings.php?search=true`.
// Ported from github.com/strelov1/freehire internal/ingest/sources/hrmdirect.go (MIT).
// Live-probed 2026-10-21 against https://sundance.hrmdirect.com (200, ~40 KB,
// server-rendered table, no auth).
//
// `search=true` with no filters is the site's own "all openings" query: the WHOLE
// board in one page, no pagination. A posting is keyed by the PAIR (req, req_loc)
// — one requisition open in several locations is listed once per location.
// Each row: <tr class="reqitem…"> … <td class="posTitle"><a href="job-opening.php?req=N&req_loc=M…">Title</td>
//   <td class="cities">City</td><td class="state">ST</td>.
// freehire fetches each job page for the description; Jobber stays list-only, so
// description and postedAt (the platform exposes no date) are omitted.
//
// Known limit: pages are served as windows-1252 without a charset header and
// ctx.fetchText decodes UTF-8, so non-ASCII punctuation in titles may become U+FFFD.
// The origin's latency is erratic (0.7s to 50s measured by freehire), hence the
// longer timeout.

import { decodeEntities } from './_html-entities.mjs';

const HRM_HOST_RE = /^[a-z0-9][a-z0-9-]*\.hrmdirect\.com$/;
const LIST_TIMEOUT_MS = 30_000;

/**
 * Tenant origin from entry.api / entry.careers_url, or null if not an HRM Direct host.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveOrigin(entry) {
  const raw = String((typeof entry?.api === 'string' && entry.api) || (typeof entry?.careers_url === 'string' && entry.careers_url) || '').trim();
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !HRM_HOST_RE.test(u.hostname)) return null;
  return `https://${u.hostname}`;
}

/** @param {string} s */
const clean = (s) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** @param {string} row @param {string} cls */
function cellText(row, cls) {
  const m = row.match(new RegExp(`<td\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</td>`, 'i'));
  return m ? clean(m[1]) : '';
}

/**
 * Parse the job-openings listing. Exported for unit tests.
 * Both numeric `req` and `req_loc` are required (a link with only `req` is the
 * filter form's); rows are deduped on the pair and the URL is rebuilt from the ids.
 *
 * @param {string} html
 * @param {string} origin e.g. "https://acme.hrmdirect.com"
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseHrmDirectListing(html, origin, companyName) {
  if (typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();
  for (const rowM of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowM[1];
    const a = row.match(/<a\b[^>]*href=["']([^"']*job-opening\.php[^"']*)["'][^>]*>([\s\S]*?)(?:<\/a>|<\/td>)/i);
    if (!a) continue;
    let q;
    try {
      q = new URL(decodeEntities(a[1]), `${origin}/employment/`).searchParams;
    } catch {
      continue;
    }
    const req = q.get('req') ?? '';
    const loc = q.get('req_loc') ?? '';
    if (!/^\d+$/.test(req) || !/^\d+$/.test(loc) || seen.has(`${req}-${loc}`)) continue;
    const title = cellText(row, 'posTitle') || clean(a[2]);
    if (!title) continue;
    seen.add(`${req}-${loc}`);
    const location = [cellText(row, 'cities'), cellText(row, 'state')].filter(Boolean).join(', ');
    out.push({
      title,
      url: `${origin}/employment/job-opening.php?req=${req}&req_loc=${loc}`,
      company: companyName,
      location,
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'hrmdirect',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}/employment/job-openings.php?search=true` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`hrmdirect: cannot derive <tenant>.hrmdirect.com URL for ${entry.name}`);
    // redirect:'error' keeps the final host pinned to the validated tenant (SSRF).
    const html = await ctx.fetchText(`${origin}/employment/job-openings.php?search=true`, {
      redirect: 'error',
      timeoutMs: LIST_TIMEOUT_MS,
    });
    return parseHrmDirectListing(html, origin, entry.name);
  },
};
