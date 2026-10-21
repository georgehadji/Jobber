// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Deel provider — Deel's multi-tenant ATS career boards (jobs.deel.com/<org>).
// The board page is a server-rendered Next.js app that inlines the org's whole
// catalogue in the React flight stream (`self.__next_f.push([1,"…"])` chunks),
// so ONE GET per board yields every posting. Descriptions are "$N" references
// into length-delimited text rows of the same stream; this port skips them
// (title/location/date are enough for the scanner), so `description` is omitted.
//
// PROVENANCE: adapted from github.com/strelov1/freehire
// internal/ingest/sources/deel.go + nextflight.go (MIT). Live probe 2026-10-21:
// https://jobs.deel.com/klarna → 200 (~870 KB), no auth, jobPostings[] present.
//
// Salary: `job.currentCompensation` has min/max/currency but no stated period,
// so `salary` is deliberately omitted (annualization rule in _types.js).
//
// Auto-detects from `https://jobs.deel.com/<org-slug>[/...]`.

const HOST = 'jobs.deel.com';
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const POSTING_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PUSH_RE = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null} org slug
 */
function resolveSlug(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== HOST || u.port) return null;
  const m = /^\/([^/]+)(?:\/|$)/.exec(u.pathname);
  return m && SLUG_RE.test(m[1]) ? m[1] : null;
}

/** @param {string} url */
function assertDeelUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`deel: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:' || u.hostname !== HOST || u.port) {
    throw new Error(`deel: untrusted URL "${url}" — must be https://${HOST}/…`);
  }
  return url;
}

/**
 * Concatenate and JS-string-decode every flight chunk in the page.
 * @param {string} html
 * @returns {string}
 */
export function decodeNextFlight(html) {
  let out = '';
  for (const m of String(html || '').matchAll(PUSH_RE)) {
    try {
      out += JSON.parse(m[1]);
    } catch {
      /* a malformed chunk is skipped; a missing array is reported by the caller */
    }
  }
  return out;
}

/**
 * The balanced `open…close` run following the first `key` in `s`, or null.
 * Depth is counted outside JSON string literals only, so a bracket inside a
 * value ("[EMEA] Engineer") cannot unbalance the scan.
 * @param {string} s
 * @param {string} key
 * @param {string} open
 * @param {string} close
 */
export function bracketSlice(s, key, open, close) {
  const at = s.indexOf(key);
  if (at < 0) return null;
  const start = s.indexOf(open, at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/**
 * Parse a board page into Jobs. Throws when the page carries no `jobPostings`
 * array (a markup change must surface, not silently empty the board); an empty
 * array is valid. Rows without an id or title are dropped. Exported for tests.
 * @param {string} html
 * @param {string} slug
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseDeelBoard(html, slug, companyName) {
  const flight = decodeNextFlight(html);
  const rawPostings = bracketSlice(flight, '"jobPostings":', '[', ']');
  if (rawPostings === null) throw new Error(`deel: board "${slug}": no jobPostings array in page`);
  const postings = JSON.parse(rawPostings);
  let org = '';
  const settings = bracketSlice(flight, '"careerPageSettings":', '{', '}');
  if (settings) {
    try {
      org = String(JSON.parse(settings).preferredOrganizationName || '').trim();
    } catch {
      /* fall back to the configured name */
    }
  }
  const jobs = [];
  for (const p of Array.isArray(postings) ? postings : []) {
    const id = String(p?.id ?? '');
    const title = String(p?.title ?? '').trim();
    if (!POSTING_ID_RE.test(id) || !title) continue;
    const places = (Array.isArray(p.job?.jobLocations) ? p.job.jobLocations : [])
      .map((/** @type {any} */ l) => String(l?.location?.name ?? '').trim())
      .filter(Boolean);
    const remote = p.job?.workArrangementEnum === 'REMOTE' && !places.some((x) => /remote/i.test(x));
    const job = {
      title,
      url: `https://${HOST}/${slug}/job-details/${id}/overview`,
      company: org || companyName,
      location: [...places, ...(remote ? ['Remote'] : [])].join(', '),
    };
    const ts = Date.parse(String(p.createdAt ?? ''));
    if (Number.isFinite(ts)) /** @type {any} */ (job).postedAt = ts;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'deel',

  detect(entry) {
    const slug = resolveSlug(entry);
    return slug ? { url: `https://${HOST}/${slug}` } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`deel: cannot derive org slug for ${entry.name}`);
    // Single request; the board page is large (~1 MB), so allow a longer timeout.
    const html = await ctx.fetchText(assertDeelUrl(`https://${HOST}/${slug}`), { redirect: 'error', timeoutMs: 30_000 });
    return parseDeelBoard(html, slug, entry.name);
  },
};
