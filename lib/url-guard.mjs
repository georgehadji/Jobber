// @ts-check
// lib/url-guard.mjs — the one "is this a followable web URL" predicate.
// Scanner intake, providers and the finalizer all need the same answer, and a
// local `startsWith('http')` accepts `httpx://` and `http.exe`.

/**
 * True only for an absolute http(s) URL that `new URL()` parses.
 * @param {unknown} u
 * @returns {boolean}
 */
export function isHttpUrl(u) {
  if (typeof u !== 'string') return false;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}
