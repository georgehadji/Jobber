// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Gupy provider — Brazil's dominant ATS (career pages at <subdomain>.gupy.io).
// Ported from freehire (github.com/strelov1/freehire,
// internal/ingest/sources/gupy.go, MIT). Live-probed 2026-10-21 with board
// `caju` (200, real postings, no auth).
//
// One unpaginated GET lists a career page's published postings:
//   https://private-api.gupy.io/job-publication/public/jobs?subdomain=<board>
// The list carries title + address + workplace type only. The body and the
// publish date live in a per-posting detail request, which the zero-token
// scanner skips — so `description` and `postedAt` are omitted.

const GUPY_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.gupy\.io$/;
const GUPY_API = 'https://private-api.gupy.io/job-publication/public/jobs';
// Vendor/infra subdomains that are not career pages.
const RESERVED = new Set(['www', 'portal', 'api', 'private-api', 'employability-portal', 'app', 'help']);

/**
 * Career-page subdomain from an entry, or null.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveBoard(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const m = GUPY_HOST_RE.exec(u.hostname);
  return m && !RESERVED.has(m[1]) ? m[1] : null;
}

/** @param {string} board */
function listUrl(board) {
  return `${GUPY_API}?subdomain=${encodeURIComponent(board)}`;
}

/**
 * Parse a Gupy listing response. Exported for unit tests.
 * @param {any} json
 * @param {string} board
 * @param {string} companyName
 */
export function parseGupyResponse(json, board, companyName) {
  const rows = json?.data;
  if (!Array.isArray(rows)) return [];
  /** @type {Array<{title: string, url: string, company: string, location: string}>} */
  const out = [];
  for (const p of rows) {
    const title = typeof p?.name === 'string' ? p.name.trim() : '';
    const id = Number.isSafeInteger(p?.id) && p.id > 0 ? p.id : 0;
    if (!title || !id) continue;
    const loc = [p.addressCity, p.addressStateShortName, p.addressCountry]
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean);
    if (p.remoteWorking === true || p.workplaceType === 'remote') loc.push('Remote');
    out.push({
      title,
      url: `https://${board}.gupy.io/jobs/${id}`,
      company: companyName,
      location: loc.join(', '),
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'gupy',

  detect(entry) {
    const board = resolveBoard(entry);
    return board ? { url: listUrl(board) } : null;
  },

  async fetch(entry, ctx) {
    const board = resolveBoard(entry);
    if (!board) throw new Error(`gupy: cannot derive career-page subdomain for ${entry.name}`);
    // Fixed API host + redirect:'error' — the board only ever lands in a query value.
    const json = await ctx.fetchJson(listUrl(board), { redirect: 'error' });
    return parseGupyResponse(json, board, entry.name);
  },
};
