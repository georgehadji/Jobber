// @ts-check
/**
 * lib/ats-detect.mjs — find the ATS board behind a company's own careers page
 * (docs/FREEHIRE-INTEGRATION-PLAN.md Phase 7).
 *
 * Idea from freehire's internal/ingest/atsdetect (github.com/strelov1/freehire,
 * MIT): a branded careers page usually links to, or embeds, its ATS board.
 * freehire keeps its own regex table per vendor; this module keeps none.
 * Every link on the page is routed through the SAME providers/_registry.mjs
 * resolveProvider() scan.mjs uses, so all detect()-capable providers are
 * recognised automatically and a board found here is exactly one scan.mjs can
 * read. Board-wide providers (explicit `provider:` only) never match a link.
 *
 * Self-hosted platforms (Radancy, Phenom, Jibe, Teamtailor) serve from the
 * employer's own domain with nothing ATS-shaped in the URL; their vendor
 * bundle in the markup is the only tell. Those are returned as a HINT only —
 * the caller still has to configure `provider:` + `api:` by hand.
 *
 * Network: fetchPage() is the only I/O. It follows at most MAX_REDIRECTS
 * redirects by hand, validating every hop with assertPublicHttpsUrl, so a
 * redirect cannot walk into localhost or a private address literal.
 */

import { resolveProvider } from '../providers/_registry.mjs';
import { normalizeHost } from './net-guard.mjs';

export const MAX_REDIRECTS = 3;
const MAX_URLS = 500;
const MAX_HTML_BYTES = 3_000_000;

// Markers freehire found to be unique per vendor across its sampled boards.
const SELF_HOSTED = Object.freeze([
  { provider: 'radancy', marker: /talentbrew/i },
  { provider: 'phenom', marker: /phenompeople/i },
  { provider: 'jibeapply', marker: /jibeapply/i },
  { provider: 'teamtailor', marker: /teamtailor/i },
]);

/**
 * Throws unless `raw` is an https URL on a public DNS name: no IP literal,
 * localhost, internal-only suffix, port, or userinfo.
 * shortcut: checks the hostname text only — a public name that RESOLVES to a
 * private address is not caught; add a DNS check if this ever takes
 * untrusted input (today it only reads the user's own company list).
 * @param {string} raw
 * @returns {URL}
 */
export function assertPublicHttpsUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error(`invalid URL: ${raw}`); }
  if (u.protocol !== 'https:') throw new Error(`URL must use https: ${raw}`);
  if (u.username || u.password) throw new Error(`URL must not carry credentials: ${raw}`);
  if (u.port) throw new Error(`URL must not set a port: ${raw}`);
  const host = normalizeHost(u.hostname);
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) throw new Error(`IP-literal hosts are not allowed: ${raw}`);
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) {
    throw new Error(`non-public host: ${host}`);
  }
  return u;
}

/**
 * Candidate page URLs for a company website: the page itself, then /careers
 * and /jobs on its origin. A bare domain ("mollie.com") gets https:// added.
 * @param {string} website
 * @returns {string[]}
 */
export function candidatePages(website) {
  const raw = String(website || '').trim();
  if (!raw) return [];
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let base;
  try { base = assertPublicHttpsUrl(withScheme); } catch { return []; }
  const out = [base.href];
  for (const path of ['/careers', '/jobs']) {
    const u = new URL(path, base.origin).href;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * Rewrite legacy link shapes careers pages still carry into the host the
 * provider's detect() accepts: Greenhouse's old `boards.greenhouse.io/<slug>`
 * and its embed script (`.../embed/job_board[/js]?for=<slug>`) become
 * `job-boards[.eu].greenhouse.io/<slug>`. Anything else passes through.
 * @param {URL} u
 * @returns {URL}
 */
export function canonicalizeAtsLink(u) {
  const gh = u.hostname.match(/^boards(\.eu)?\.greenhouse\.io$/i);
  if (!gh) return u;
  const slug = /^\/embed\/job_board(?:\/js)?\/?$/i.test(u.pathname)
    ? u.searchParams.get('for')
    : u.pathname.split('/')[1];
  if (!slug || slug === 'embed' || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return u;
  return new URL(`https://job-boards${gh[1] || ''}.greenhouse.io/${slug}`);
}

/**
 * Every absolute https URL a page references: attribute values (href, src,
 * action, data-*, content) resolved against the page URL, plus bare URLs in
 * inline scripts and text. Deduped, fragments dropped, capped at MAX_URLS.
 * @param {string} html
 * @param {string} pageUrl
 * @returns {string[]}
 */
export function extractCandidateUrls(html, pageUrl) {
  const text = String(html || '').slice(0, MAX_HTML_BYTES);
  const seen = new Set();
  /** @param {string} value */
  const add = (value) => {
    if (seen.size >= MAX_URLS) return;
    const v = value.replace(/&amp;/g, '&').replace(/\\\//g, '/').trim();
    if (!v || v.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(v)) return;
    let u;
    try { u = new URL(v, pageUrl); } catch { return; }
    if (u.protocol !== 'https:') return;
    u.hash = '';
    seen.add(canonicalizeAtsLink(u).href);
  };
  add(pageUrl);
  for (const m of text.matchAll(/\b(?:href|src|action|content|data-[a-z0-9-]+)\s*=\s*["']([^"'<>]+)["']/gi)) add(m[1]);
  for (const m of text.matchAll(/https:(?:\/|\\\/){2}[^\s"'<>()\\]+(?:\\\/[^\s"'<>()\\]+)*/gi)) add(m[0]);
  return [...seen];
}

/**
 * The provider that claims the first URL (in page order), with the SHORTEST
 * URL that provider claims on the page — a board root ("jobs.ashbyhq.com/acme")
 * rather than one posting under it, which is what belongs in portals.yml.
 * @param {string[]} urls
 * @param {Map<string, any>} providers  from providers/_registry.mjs loadProviders()
 * @param {{ company?: string }} [opts]  with a company name, a claimed board whose URL names that company
 *   wins over page order, and when none does the result carries confidence 'unverified': a careers page
 *   also links partners, competitors and customers, so "first link on the page" is not evidence.
 * @returns {{provider: string, careers_url: string, confidence?: 'verified'|'unverified'} | null}
 */
export function detectBoard(urls, providers, { company = '' } = {}) {
  /** @param {string} careers_url */
  const claim = (careers_url) => {
    const hit = resolveProvider({ name: 'ats-detect', careers_url }, providers, { skipIds: ['local-parser'] });
    return hit && 'provider' in hit ? /** @type {{id: string}} */ (hit.provider).id : null;
  };
  const first = urls.map((u) => ({ u, id: claim(u) })).filter((x) => x.id);
  if (!first.length) return null;
  const fold = (/** @type {string} */ t) => String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const name = fold(company);
  let confidence;
  let ordered = first;
  if (name.length >= 3) {
    const named = first.filter((x) => fold(x.u).includes(name));
    confidence = named.length ? 'verified' : 'unverified';
    if (named.length) ordered = named;
  }
  const provider = ordered[0].id;
  const careers_url = ordered.filter((x) => x.id === provider).map((x) => x.u).sort((a, b) => a.length - b.length)[0];
  return confidence ? { provider, careers_url, confidence } : { provider, careers_url };
}

/**
 * Self-hosted platform hint from the page markup, or null. Never returned for
 * pages on the vendor's own domain (their marketing site carries the marker).
 * @param {string} html
 * @param {string} pageUrl
 * @returns {{provider: string, careers_url: string} | null}
 */
export function detectSelfHosted(html, pageUrl) {
  let host = '';
  try { host = new URL(pageUrl).hostname.toLowerCase(); } catch { return null; }
  for (const { provider, marker } of SELF_HOSTED) {
    if (host.includes(provider)) continue;
    if (marker.test(String(html || ''))) return { provider, careers_url: pageUrl };
  }
  return null;
}

/**
 * Read at most `max` characters of a response body, then stop the download (a hostile or huge page
 * must not be buffered whole before it is capped). Falls back to text() for a body without a reader.
 * @param {any} res
 * @param {number} max
 * @returns {Promise<string>}
 */
async function readCapped(res, max) {
  if (!res.body || typeof res.body.getReader !== 'function') return String(await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  try {
    while (out.length < max) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out.slice(0, max);
}

/**
 * GET a page, following up to MAX_REDIRECTS redirects by hand so every hop is
 * validated. Returns { url (final), html }.
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{url: string, html: string}>}
 */
export async function fetchPage(url, { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  let current = assertPublicHttpsUrl(url).href;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; jobber/1.3)', accept: 'text/html,*/*;q=0.5' },
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel?.().catch(() => {}); // do not leave the redirect body open
        const location = res.headers.get('location');
        if (!location) throw new Error(`HTTP ${res.status} without Location at ${current}`);
        current = assertPublicHttpsUrl(new URL(location, current).href).href;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel?.().catch(() => {});
        throw Object.assign(new Error(`HTTP ${res.status} at ${current}`), { status: res.status });
      }
      return { url: current, html: await readCapped(res, MAX_HTML_BYTES) };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`more than ${MAX_REDIRECTS} redirects from ${url}`);
}
