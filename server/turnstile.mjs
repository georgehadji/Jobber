// server/turnstile.mjs — server-side Cloudflare Turnstile check. Fails closed.
// Sends Cloudflare only the secret and the visitor's token. No IP, no CV, no job text.

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * @returns {(token: string) => Promise<{ok: true} | {ok: false, reason: 'missing'|'rejected'|'unavailable'}>}
 */
export function createTurnstile({ secret, fetchFn = fetch, timeoutMs = 5000 }) {
  return async (token) => {
    if (!token || token.length > 2048) return { ok: false, reason: 'missing' };
    try {
      const res = await fetchFn(SITEVERIFY, {
        method: 'POST',
        body: new URLSearchParams({ secret, response: token }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { ok: false, reason: 'unavailable' };
      return (await res.json()).success === true ? { ok: true } : { ok: false, reason: 'rejected' };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  };
}
