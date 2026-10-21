// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Oracle Taleo Business Edition (TBE) provider — the small-business Taleo
// product on `<pod>.tbe.taleo.net`. Every career site publishes its whole
// listing as ONE public RSS document (no auth, no pagination, no detail
// request), so a board costs a single GET.
// Provenance: github.com/strelov1/freehire internal/ingest/sources/taleobe.go (MIT).
// Live-probed 2026-10-21 against AmeriHealth Caritas
// (phh.tbe.taleo.net/phh02, org AMERINC, cws 52): HTTP 200 text/xml, 11 items
// with title/link/pubDate/description and taleo:reqId/location fields.
//
// Differences from the Go source: freehire addresses the feed through
// tbe.taleo.net's DispatcherServlet, which 302s to the org's pod. Jobber pins
// `redirect:'error'` on every request, so we request the pod feed directly
// (`https://<pod>.tbe.taleo.net/<podNN>/ats/servlet/Rss?org=&cws=`, which
// answers 200 itself) and therefore need the pod from the URL. A bare
// dispatcher link carries no pod and is NOT claimed (shortcut: such boards
// need a pod-bearing careers_url; upgrade by following the dispatcher hop).
//
// Auto-detects from `https://<pod>.tbe.taleo.net/<podNN>/ats/...?org=<ORG>&cws=<n>`.
// Taleo Enterprise (`<tenant>.taleo.net/careersection/...`, providers/taleo.mjs)
// is a different product and is never claimed here; taleo.mjs in turn rejects
// tbe.taleo.net, so the two detect() functions are mutually exclusive.
// `description` is the feed's own plain-text <description> (free in the feed).

const TBE_HOST_RE = /^[a-z0-9]+\.tbe\.taleo\.net$/;
const POD_RE = /^[a-z0-9]{2,12}$/;
const ORG_RE = /^[A-Z0-9_]{1,64}$/;
const CWS_RE = /^[0-9]{1,6}$/;
const RID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * `{host, pod, org, cws}` from a TBE careers URL; null if not one.
 * @param {unknown} raw
 * @returns {{host: string, pod: string, org: string, cws: string} | null}
 */
export function parseTaleobeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !TBE_HOST_RE.test(u.hostname)) return null;
  const pod = /^\/([a-z0-9]+)\/ats\//i.exec(u.pathname)?.[1]?.toLowerCase() ?? '';
  const org = (u.searchParams.get('org') ?? '').trim().toUpperCase();
  const cws = (u.searchParams.get('cws') ?? '').trim();
  if (!POD_RE.test(pod) || !ORG_RE.test(org) || !CWS_RE.test(cws)) return null;
  return { host: u.hostname, pod, org, cws };
}

/** @param {{host: string, pod: string, org: string, cws: string}} b */
function feedUrl(b) {
  return assertTaleobeUrl(`https://${b.host}/${b.pod}/ats/servlet/Rss?org=${encodeURIComponent(b.org)}&cws=${encodeURIComponent(b.cws)}`);
}

/** @param {string} url */
function assertTaleobeUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`taleobe: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:') throw new Error(`taleobe: URL must use HTTPS: ${url}`);
  if (!TBE_HOST_RE.test(u.hostname)) {
    throw new Error(`taleobe: untrusted hostname "${u.hostname}" — must match <pod>.tbe.taleo.net`);
  }
  return url;
}

function fromCodePoint(/** @type {number} */ cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

// Numeric first, &amp; LAST so "&amp;lt;" yields "&lt;" and not "<".
function decodeXmlEntities(/** @type {string} */ s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractText(/** @type {string} */ inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return (cdata ? cdata[1] : decodeXmlEntities(inner)).trim();
}

// First <tag>…</tag> in a block ('' when absent). The feed binds the taleo:
// elements to urn:TBERss via the `taleo` prefix; matching the prefix literally
// is a documented simplification (the platform has always emitted it).
function tagText(/** @type {string} */ block, /** @type {string} */ tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? extractText(m[1]) : '';
}

/**
 * Parse a TBE RSS feed. Exported for unit tests.
 *
 * Items without a title or a usable requisition id (taleo:reqId, else the
 * `rid` of the item link) are dropped. The posting URL is rebuilt from the
 * validated board + rid rather than trusting the feed's link host.
 *
 * @param {string} xml
 * @param {{host: string, pod: string, org: string, cws: string}} board
 * @param {string} [company]
 * @returns {import('./_types.js').Job[]}
 */
export function parseTaleobeFeed(xml, board, company = '') {
  if (typeof xml !== 'string') return [];
  const name = typeof company === 'string' ? company.trim() : '';
  /** @type {import('./_types.js').Job[]} */
  const jobs = [];
  const seen = new Set();
  for (const item of xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || []) {
    const title = tagText(item, 'title');
    let rid = tagText(item, 'taleo:reqId');
    if (!rid) {
      try {
        rid = new URL(tagText(item, 'link')).searchParams.get('rid') ?? '';
      } catch { /* no usable link */ }
    }
    rid = rid.trim();
    if (!title || !RID_RE.test(rid) || seen.has(rid)) continue;
    seen.add(rid);
    const city = tagText(item, 'taleo:locationCity');
    const state = tagText(item, 'taleo:locationState');
    const location = tagText(item, 'taleo:location') || [city, state].filter(Boolean).join(', ');
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: `https://${board.host}/${board.pod}/ats/careers/requisition.jsp?org=${encodeURIComponent(board.org)}&cws=${encodeURIComponent(board.cws)}&rid=${encodeURIComponent(rid)}`,
      company: name,
      location,
    };
    const description = tagText(item, 'description').replace(/\s+/g, ' ').trim();
    if (description) job.description = description;
    const posted = Date.parse(tagText(item, 'pubDate'));
    if (!Number.isNaN(posted)) job.postedAt = posted;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'taleobe',

  detect(entry) {
    const board = parseTaleobeUrl(entry?.careers_url);
    return board ? { url: feedUrl(board) } : null;
  },

  async fetch(entry, ctx) {
    const board = parseTaleobeUrl(entry?.careers_url);
    if (!board) throw new Error(`taleobe: cannot derive pod/org/cws from careers_url for ${entry?.name}`);
    // redirect:'error' + the host check keep the request pinned to *.tbe.taleo.net (SSRF).
    const xml = await ctx.fetchText(feedUrl(board), { redirect: 'error' });
    const company = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : board.org;
    return parseTaleobeFeed(xml, board, company);
  },
};
