// HTTP transport helpers shared across providers.
// Files prefixed with _ are never loaded as providers by scan.mjs.

import './_dns-cache.mjs'; // memoize dns.lookup process-wide (see that file)

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; jobber/1.3)';

/**
 * Browser-like User-Agent for providers that must clear WAF/CDN bot
 * management blocking the default Jobber UA outright (seen live:
 * Glints' firewall, Geico's Cloudflare-gated Workday tenant). Shared so
 * every provider working around such a block bumps one constant instead
 * of drifting Chrome versions independently per file.
 */
export const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── Shared per-host politeness limiter (#improvement-plan A3) ────────────
// 67 providers share no rate limit today. Against free public ATS endpoints,
// politeness is not an optimisation — it is the terms of use: an honest client
// that spaces its hits is less likely to get a whole host blocked. This is a
// minimal, opt-in spacing limiter: one recent-next-request-time per host. It is
// a linear "don't hammer" gate, not a token bucket or a circuit breaker — a scan
// that runs a few times a day does not need either.
const hostNextAllowedMs = new Map(); // host -> earliest ms we may hit it again

/**
 * Wait until the host of `url` may be requested again, spacing calls that share
 * a host by at least `minIntervalMs`. Always returns a Promise; no-op (resolves
 * immediately) when `minIntervalMs` is falsy. Hopeless URLs (no parseable host)
 * never block.
 *
 * @param {string} url - Request URL whose host to throttle.
 * @param {number} [minIntervalMs] - Minimum gap between two hits of the same host.
 * @returns {Promise<void>}
 */
export async function hostRateLimit(url, minIntervalMs) {
  if (!minIntervalMs || minIntervalMs <= 0) return;
  let host;
  try { host = new URL(url).host; } catch { return; }
  const now = Date.now();
  const next = hostNextAllowedMs.get(host) ?? 0;
  hostNextAllowedMs.set(host, Math.max(next, now + minIntervalMs));
  if (now < next) {
    await new Promise(r => setTimeout(r, next - now));
  }
}

async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, method = 'GET', body = null, redirect = 'follow', rateLimitMs = 0 } = {}, consume) {
  await hostRateLimit(url, rateLimitMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'user-agent': DEFAULT_USER_AGENT, ...headers },
      body,
      redirect,
      signal: controller.signal,
    });
    if (!res.ok) {
      const responseText = await res.text().catch(() => '');
      // WAF/CDN challenge pages (seen live: Workday 429s) carry no actionable
      // text — HTML markup or a generic interstitial message, not worth
      // parsing or displaying. The status code and its standard reason
      // phrase are what a log line needs; the raw body is still attached as
      // err.body for callers that want to inspect it.
      const err = new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
      err.status = res.status;
      err.body = responseText;
      err.retryAfter = res.headers.get('retry-after');
      throw err;
    }
    // Body consumption must stay inside the timer window: a server that sends
    // headers and then stalls the body otherwise hangs the caller forever
    // (this froze full-directory sweeps silently — 20 workers all stuck on
    // stalled reads with the abort timer already cleared).
    return await consume(res);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts = {}) {
  return fetchWithTimeout(url, opts, (res) => res.json());
}

export async function fetchText(url, opts = {}) {
  return fetchWithTimeout(url, opts, (res) => res.text());
}

export function makeHttpCtx({ rateLimitMs = 0 } = {}) {
  return {
    transport: 'http',
    fetchJson: (url, opts = {}) => fetchJson(url, { rateLimitMs, ...opts }),
    fetchText: (url, opts = {}) => fetchText(url, { rateLimitMs, ...opts }),
  };
}
