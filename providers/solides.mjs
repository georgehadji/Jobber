// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Solides provider — Brazilian ATS; career pages at <slug>.vagas.solides.com.br.
// Ported from freehire (github.com/strelov1/freehire,
// internal/ingest/sources/solides.go, MIT). Live-probed 2026-10-21 with tenant
// `dynamox` (200, real postings with inline HTML description, no auth).
//
//   GET https://apigw.solides.com.br/jobs/v3/home/vacancy?slug=<slug>&take=25&page=N
//   → { data: { totalPages, data: [{ id, title, description, currentState,
//        city:{name}, state:{code}, homeOffice, createdAt }] } }
// take is capped server-side at 25. Salary is present but its period is not
// stated, so it is omitted (annualization rule).

import { decodeEntities } from './_html-entities.mjs';

const SOLIDES_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.vagas\.solides\.com\.br$/;
const API = 'https://apigw.solides.com.br/jobs/v3/home/vacancy';
const PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 10;
const OPEN_STATE = 'em_andamento';

/** @param {unknown} s */
function htmlToText(s) {
  const raw = String(s ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(raw).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveSlug(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const m = SOLIDES_HOST_RE.exec(u.hostname);
  return m ? m[1] : null;
}

/**
 * @param {string} slug
 * @param {number} page
 */
function pageUrl(slug, page) {
  return `${API}?slug=${encodeURIComponent(slug)}&take=${PAGE_SIZE}&page=${page}`;
}

/**
 * Parse one Solides page payload. Exported for unit tests.
 * Closed vacancies (currentState present and not "em_andamento") are dropped.
 * @param {any} json
 * @param {string} slug
 * @param {string} companyName
 */
export function parseSolidesPage(json, slug, companyName) {
  const rows = json?.data?.data;
  if (!Array.isArray(rows)) return [];
  /** @type {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>} */
  const out = [];
  for (const p of rows) {
    const title = typeof p?.title === 'string' ? p.title.trim() : '';
    const id = Number.isSafeInteger(p?.id) && p.id > 0 ? p.id : 0;
    if (!title || !id) continue;
    if (p.currentState && p.currentState !== OPEN_STATE) continue;
    const loc = [p.city?.name, p.state?.code].filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
    if (p.homeOffice === true) loc.push('Remote');
    /** @type {{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}} */
    const job = {
      title,
      url: `https://${slug}.vagas.solides.com.br/vaga/${id}`,
      company: companyName,
      location: loc.join(', '),
    };
    const description = htmlToText(p.description);
    if (description) job.description = description;
    const ts = typeof p.createdAt === 'string' ? Date.parse(p.createdAt) : NaN;
    if (Number.isFinite(ts)) job.postedAt = ts;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'solides',

  detect(entry) {
    const slug = resolveSlug(entry);
    return slug ? { url: pageUrl(slug, 1) } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`solides: cannot derive tenant slug for ${entry.name}`);
    const maxPages = Number.isInteger(ctx.maxPages) && /** @type {number} */ (ctx.maxPages) > 0 ? /** @type {number} */ (ctx.maxPages) : DEFAULT_MAX_PAGES;
    const sleep = ctx.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    /** @type {ReturnType<typeof parseSolidesPage>} */
    const jobs = [];
    for (let page = 1; page <= maxPages; page++) {
      const json = /** @type {any} */ (await ctx.fetchJson(pageUrl(slug, page), { redirect: 'error' }));
      const rows = json?.data?.data;
      if (!Array.isArray(rows) || rows.length === 0) break;
      jobs.push(...parseSolidesPage(json, slug, entry.name));
      const totalPages = Number(json?.data?.totalPages);
      if (!Number.isFinite(totalPages) || page >= totalPages) break;
      await sleep(250);
    }
    return jobs;
  },
};
