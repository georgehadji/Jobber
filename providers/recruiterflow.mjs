// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// RecruiterFlow provider — agency career pages at recruiterflow.com/<board>/jobs.
// Ported from freehire (github.com/strelov1/freehire,
// internal/ingest/sources/recruiterflow.go, MIT). Live-probed 2026-10-21 with
// board `radhires` (200, no auth).
//
// The page is a legacy jQuery SPA, but the whole board is embedded in the raw
// HTML as `window.jobsList = {"department": [[name, [item, …]], …]};` with
// item = { apply_link, details, employment_type, job_id, job_name,
// last_opened, remote_type }. Everything needed is in that one page; the
// per-posting description (a second request) is omitted. A board is a
// recruiting agency, so `company` is the entry name.

const BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Board slug from `https://recruiterflow.com/<board>/jobs[...]`, or null.
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
  if (u.hostname !== 'recruiterflow.com' && u.hostname !== 'www.recruiterflow.com') return null;
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 2 || segs[1] !== 'jobs' || !BOARD_RE.test(segs[0])) return null;
  return segs[0];
}

/**
 * Extract the balanced `{…}` literal following `marker`, string/escape aware.
 * @param {string} text
 * @param {string} marker
 * @returns {string | null}
 */
export function extractJsObject(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const open = text.indexOf('{', start + marker.length);
  if (open < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  return null;
}

/**
 * Parse the board page HTML. Exported for unit tests. Throws when the
 * embedded jobsList is missing (a broken board must not look empty).
 * @param {string} html
 * @param {string} board
 * @param {string} companyName
 */
export function parseRecruiterflowPage(html, board, companyName) {
  const lit = extractJsObject(String(html), 'window.jobsList');
  if (!lit) throw new Error(`recruiterflow: no window.jobsList on board "${board}"`);
  const data = JSON.parse(lit);
  const groups = Array.isArray(data?.department) ? data.department : [];
  /** @type {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>} */
  const out = [];
  const seen = new Set();
  for (const g of groups) {
    const items = Array.isArray(g) && Array.isArray(g[1]) ? g[1] : [];
    for (const it of items) {
      const title = typeof it?.job_name === 'string' ? it.job_name.trim() : '';
      const link = typeof it?.apply_link === 'string' ? it.apply_link : '';
      // Relative `<board>/jobs/<id>` only — never an absolute or foreign URL.
      if (!title || !/^[A-Za-z0-9_-]+\/jobs\/\d+$/.test(link)) continue;
      const url = `https://recruiterflow.com/${link}`;
      if (seen.has(url)) continue;
      seen.add(url);
      const loc = typeof it.details === 'string' ? it.details.trim() : '';
      const remote = /^remote$/i.test(String(it.remote_type)) && !/remot/i.test(loc);
      /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
      const job = {
        title,
        url,
        company: companyName,
        location: remote ? [loc, 'Remote'].filter(Boolean).join(', ') : loc,
      };
      const ts = typeof it.last_opened === 'string' ? Date.parse(it.last_opened.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) : NaN;
      if (Number.isFinite(ts)) job.postedAt = ts;
      out.push(job);
    }
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'recruiterflow',

  detect(entry) {
    const board = resolveBoard(entry);
    return board ? { url: `https://recruiterflow.com/${board}/jobs` } : null;
  },

  async fetch(entry, ctx) {
    const board = resolveBoard(entry);
    if (!board) throw new Error(`recruiterflow: cannot derive board for ${entry.name}`);
    const html = await ctx.fetchText(`https://recruiterflow.com/${board}/jobs`, { redirect: 'error' });
    return parseRecruiterflowPage(html, board, entry.name);
  },
};
