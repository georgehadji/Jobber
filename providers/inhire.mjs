// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// InHire provider — ATS behind a number of Brazilian company career sites
// (<tenant>.inhire.app). Ported from freehire (github.com/strelov1/freehire,
// internal/ingest/sources/inhire.go, MIT). Live-probed 2026-10-21 with tenant
// `contaazul` (200, 17 published posts, no auth).
//
//   GET https://api.inhire.app/job-posts/public/pages   header X-Tenant: <tenant>
//   → { tenantName, jobsPage: [{ jobId, displayName, workplaceType, location, status }] }
// The list has no description/date (those need a per-post detail request the
// zero-token scanner skips), so both are omitted.

const INHIRE_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.inhire\.app$/;
const RESERVED = new Set(['www', 'api', 'app', 'files', 'help']);
const API = 'https://api.inhire.app/job-posts/public/pages';

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveTenant(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const m = INHIRE_HOST_RE.exec(u.hostname);
  return m && !RESERVED.has(m[1]) ? m[1] : null;
}

/**
 * Cosmetic trailing slug the careers SPA requires (blank page without it).
 * @param {string} title
 */
export function slugify(title) {
  const s = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'vaga';
}

/**
 * Parse the InHire pages payload. Exported for unit tests.
 * @param {any} json
 * @param {string} tenant
 * @param {string} companyName
 */
export function parseInhireResponse(json, tenant, companyName) {
  const rows = json?.jobsPage;
  if (!Array.isArray(rows)) return [];
  const company = companyName || (typeof json?.tenantName === 'string' ? json.tenantName : '');
  /** @type {Array<{title: string, url: string, company: string, location: string}>} */
  const out = [];
  for (const p of rows) {
    const title = typeof p?.displayName === 'string' ? p.displayName.trim() : '';
    const id = typeof p?.jobId === 'string' ? p.jobId.trim() : '';
    if (!title || !/^[A-Za-z0-9-]{4,64}$/.test(id)) continue;
    if (p.status && p.status !== 'published') continue;
    const loc = typeof p.location === 'string' ? p.location.trim() : '';
    const remote = /^remote$/i.test(String(p.workplaceType)) && !/remot/i.test(loc);
    out.push({
      title,
      url: `https://${tenant}.inhire.app/vagas/${id}/${slugify(title)}`,
      company,
      location: remote ? [loc, 'Remote'].filter(Boolean).join(', ') : loc,
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'inhire',

  detect(entry) {
    return resolveTenant(entry) ? { url: API } : null;
  },

  async fetch(entry, ctx) {
    const tenant = resolveTenant(entry);
    if (!tenant) throw new Error(`inhire: cannot derive tenant for ${entry.name}`);
    const json = await ctx.fetchJson(API, { redirect: 'error', headers: { 'X-Tenant': tenant } });
    return parseInhireResponse(json, tenant, entry.name);
  },
};
