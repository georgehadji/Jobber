// @ts-check
// lib/robots.mjs — robots.txt gate for the browser-User-Agent escalation.
//
// Scope (deliberately narrow — see docs/AI-JOB-SEARCH-PORT-PLAN.md Phase 1):
// this gates ONLY the retry that swaps in BROWSER_LIKE_USER_AGENT
// (providers/_http.mjs) after a WAF/CDN block. It does not gate the default
// scan path against configured ATS JSON APIs — robots.txt governs crawlers
// of HTML, and gating documented API calls the user explicitly configured
// in portals.yml would regress working scans for no compliance gain.
//
// A 403 under the default UA has two very different causes: a WAF default on
// a site whose published robots.txt allows access, or a site that actually
// declined. This tells them apart before the retry escalates.
//
// Split as functional core (parseRobots/isAllowed/looksLikeRobots — pure,
// total, no IO) + imperative shell (gate — the only function that touches
// the network, via an injected fetchText so tests run with zero network,
// matching the tests/providers/_contract.test.mjs convention).

const MAX_BODY_BYTES = 512 * 1024; // RFC 9309 permits ignoring content past 500 KiB
const CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_AGENT = 'jobber';

/** origin ("scheme://host") -> { result, expiresAt } */
const cache = new Map();

/**
 * Does this body actually look like a robots.txt?
 *
 * A misconfigured host can answer /robots.txt with 200 and an HTML error
 * page. That body parses to zero rules, and zero rules reads as "allowed" —
 * so a soft-200 would grant permission that was never given. An empty or
 * whitespace-only body IS a valid allow-all under RFC 9309 and stays
 * allowed; a non-empty body with no recognized directive is unreadable.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeRobots(text) {
  if (!text || !text.trim()) return true;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.split('#', 1)[0].trim().toLowerCase();
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim();
    if (
      field === 'user-agent' || field === 'allow' || field === 'disallow' ||
      field === 'sitemap' || field === 'crawl-delay' || field === 'host'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Parse robots.txt text into per-agent rule lists.
 *
 * Tolerates a blank line inside a record without ending it — Python's
 * stdlib robotparser drops rules in that case (fails open), which is the
 * bug this deliberately does not reproduce: a rule set is only "closed" by
 * the next User-agent line, never by whitespace.
 *
 * @param {string} text
 * @returns {Map<string, Array<{allow: boolean, pattern: string}>>}
 */
export function parseRobots(text) {
  /** @type {Map<string, Array<{allow: boolean, pattern: string}>>} */
  const groups = new Map();
  let currentAgents = [];
  let expectingAgent = true;

  for (const raw of (text || '').split(/\r\n|\r|\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!expectingAgent) {
        currentAgents = [];
        expectingAgent = true;
      }
      const agent = value.toLowerCase();
      currentAgents.push(agent);
      if (!groups.has(agent)) groups.set(agent, []);
    } else if ((field === 'allow' || field === 'disallow') && currentAgents.length) {
      expectingAgent = false;
      for (const agent of currentAgents) {
        groups.get(agent).push({ allow: field === 'allow', pattern: value });
      }
    }
  }
  return groups;
}

/**
 * RFC 9309 wildcard match. `*` matches any run of characters, `$` anchors
 * end-of-path. Returns the matched pattern length (specificity), or -1 for
 * no match. An empty Disallow pattern matches nothing (RFC 9309 §2.2.2).
 *
 * The pattern is percent-decoded before matching so `Disallow: /foo%20bar`
 * blocks `/foo bar` — without this the rule silently never matches an
 * encoded path and fails open.
 *
 * Every literal character is escaped before building the regex; `*` and `$`
 * are the only metacharacters honored. A pattern is never interpolated
 * unescaped, which is what keeps this immune to ReDoS from a hostile
 * robots.txt.
 *
 * @param {string} pattern
 * @param {string} path
 * @returns {number}
 */
function matchLength(pattern, path) {
  if (pattern === '') return -1;
  let decoded;
  try {
    decoded = decodeURIComponent(pattern);
  } catch {
    decoded = pattern; // malformed percent-escape: match literally
  }
  let rx = '^';
  for (const ch of decoded) {
    if (ch === '*') rx += '.*';
    else if (ch === '$') rx += '$';
    else rx += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(rx).test(path) ? decoded.length : -1;
}

/**
 * Is `path` allowed for `agent` under the parsed rule groups? Longest match
 * wins; on an equal-length tie, Disallow wins (cautious default). Falls
 * back to the `*` group when the agent has no dedicated group; no rules at
 * all means allowed.
 *
 * @param {Map<string, Array<{allow: boolean, pattern: string}>>} groups
 * @param {string} agent
 * @param {string} path
 * @returns {boolean}
 */
export function isAllowed(groups, agent, path) {
  const rules = groups.get(agent.toLowerCase()) || groups.get('*') || [];
  let bestLen = -1;
  let bestAllow = true;
  for (const { allow, pattern } of rules) {
    const n = matchLength(pattern, path);
    if (n < 0) continue;
    if (n > bestLen || (n === bestLen && !allow)) {
      bestLen = n;
      bestAllow = allow;
    }
  }
  return bestLen < 0 ? true : bestAllow;
}

/**
 * Rebuild a same-origin robots.txt URL from a parsed URL's parts. Never
 * concatenates caller input, and only ever emits http/https — the SSRF
 * guard for this module.
 *
 * @param {URL} parsed
 * @returns {string}
 */
function robotsUrl(parsed) {
  return `${parsed.protocol}//${parsed.host}/robots.txt`;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;

/**
 * Default transport for gate(): fetch a robots.txt with a same-host-only
 * redirect cap and a hard byte cap on the response body. Callers that need
 * offline tests inject their own `fetchText` into gate() instead of using
 * this.
 *
 * SSRF posture: `redirect: 'manual'` plus a manual same-host check means a
 * cross-host redirect (e.g. a WAF sending robots.txt through a different
 * origin) is refused rather than followed — this module never fetches a
 * host the caller did not name.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
async function defaultFetchText(url) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(current, {
        method: 'GET',
        headers: { 'user-agent': `Mozilla/5.0 (compatible; jobber-robots/1.0)` },
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current);
      const currentHost = new URL(current).host;
      if (next.host !== currentHost || (next.protocol !== 'http:' && next.protocol !== 'https:')) {
        const err = new Error(`redirected off-host to ${next.host}`);
        throw err;
      }
      current = next.toString();
      continue;
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      // @ts-ignore — attaching status for gate()'s 404-means-allowed check
      err.status = res.status;
      throw err;
    }
    // Read capped: a robots.txt has no business being large, and this
    // bounds memory against a host that streams an unbounded body.
    const reader = res.body?.getReader?.();
    if (!reader) return await res.text();
    let received = '';
    let bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      received += decoder.decode(value, { stream: true });
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    return received;
  }
  throw new Error(`too many redirects fetching robots.txt (>${MAX_REDIRECTS})`);
}

/**
 * Decide whether the browser-UA retry may proceed against `url`.
 *
 * Fails closed on this path only: any outcome other than a confirmed ALLOW
 * (404, or 200 with a readable, permitting policy) returns
 * `allowed: false`. The default (non-escalated) scan path never calls this
 * and is unaffected by a robots.txt outage.
 *
 * @param {string} url - The target URL the browser-UA retry would fetch.
 * @param {{
 *   fetchText?: (url: string) => Promise<string>,
 *   agent?: string,
 *   now?: () => number,
 * }} [deps] - `fetchText` defaults to a same-host-redirect-capped, size-capped
 *   transport (see defaultFetchText). Tests inject their own to run offline;
 *   an injected fetchText must throw an Error carrying `.status` on non-2xx,
 *   matching the providers/_http.mjs convention, so a 404 can be told apart
 *   from every other failure.
 * @returns {Promise<{allowed: boolean, reason: string}>}
 */
export async function gate(url, { fetchText = defaultFetchText, agent = DEFAULT_AGENT, now = Date.now } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'UNCONFIRMED — invalid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: `UNCONFIRMED — unsupported scheme ${parsed.protocol}` };
  }

  const origin = `${parsed.protocol}//${parsed.host}`;
  const cached = cache.get(origin);
  if (cached && cached.expiresAt > now()) return cached.result;

  const target = robotsUrl(parsed);
  let body;
  try {
    body = await fetchText(target);
  } catch (err) {
    const status = err && err.status;
    if (status === 404) {
      body = '';
    } else {
      const result = { allowed: false, reason: `UNCONFIRMED — ${describeError(err)}` };
      cache.set(origin, { result, expiresAt: now() + CACHE_TTL_MS });
      return result;
    }
  }

  if (typeof body === 'string' && body.length > MAX_BODY_BYTES) {
    body = body.slice(0, MAX_BODY_BYTES);
  }

  if (!looksLikeRobots(body)) {
    const result = { allowed: false, reason: 'UNCONFIRMED — response is not a robots.txt' };
    cache.set(origin, { result, expiresAt: now() + CACHE_TTL_MS });
    return result;
  }

  const groups = parseRobots(body);
  const path = (parsed.pathname || '/') + (parsed.search || '');
  let result;
  if (!isAllowed(groups, agent, path) || !isAllowed(groups, '*', path)) {
    result = { allowed: false, reason: `DISALLOWED for ${agent} or *` };
  } else {
    result = { allowed: true, reason: 'ALLOWED — robots.txt permits this path' };
  }
  cache.set(origin, { result, expiresAt: now() + CACHE_TTL_MS });
  return result;
}

function describeError(err) {
  if (!err) return 'no attempt';
  if (err.name) return err.name;
  return String(err.message || err);
}

/** Test-only: clear the origin cache between test cases. */
export function _clearCacheForTests() {
  cache.clear();
}
