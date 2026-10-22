// lib/http-errors.mjs — classify a fetch/probe failure into a stable reason
// code. Shared by verify-portals.mjs and scan.mjs so both report the same
// vocabulary ('slug_gone'|'auth'|'network'|'server'|'unknown') for scan
// summaries and slug diagnostics.

/**
 * @param {Error|{status?: number, name?: string, message?: string}|null|undefined} err
 * @returns {'slug_gone'|'auth'|'network'|'server'|'rate_limited'|'unknown'}
 */
export function classifyFetchError(err) {
  if (!err) return 'unknown';
  if (err.name === 'AbortError') return 'network';
  const msg = String(err.message || err);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network/i.test(msg)) {
    return 'network';
  }
  const status = err.status;
  // Throttled, not dead: the scanner must not count it toward the dead-portal streak.
  if (status === 429 || /HTTP 429/.test(msg)) return 'rate_limited';
  if (status === 404 || status === 410) return 'slug_gone';
  if (status === 401 || status === 403) return 'auth';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (/HTTP 404|HTTP 410/.test(msg)) return 'slug_gone';
  if (/HTTP 401|HTTP 403/.test(msg)) return 'auth';
  if (/HTTP 5\d\d/.test(msg)) return 'server';
  return 'unknown';
}
