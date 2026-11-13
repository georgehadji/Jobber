// server/store.mjs — short-lived, in-memory result store. Nothing touches disk.
// Holds finished results (never the CV) under an unguessable token until the TTL ends.

import { randomBytes } from 'node:crypto';

export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export function createStore({ ttlMs = 30 * 60 * 1000, maxItems = 500, maxBytes = 50 * 1024 * 1024, now = Date.now } = {}) {
  const items = new Map();
  let bytes = 0;

  const drop = (token) => {
    const e = items.get(token);
    if (!e) return false;
    bytes -= e.size;
    return items.delete(token);
  };
  const sweep = () => {
    for (const [token, e] of items) if (e.expires <= now()) drop(token);
  };

  return {
    /** @returns {string|null} token, or null when the store is full */
    put(result) {
      sweep();
      const body = JSON.stringify(result);
      const size = Buffer.byteLength(body);
      if (items.size >= maxItems || bytes + size > maxBytes) return null;
      const token = randomBytes(24).toString('base64url');
      items.set(token, { body, size, expires: now() + ttlMs });
      bytes += size;
      return token;
    },
    /** @returns {{body: string, expires: number}|null} */
    get(token) {
      const e = items.get(token);
      if (!e) return null;
      if (e.expires <= now()) { drop(token); return null; }
      return e;
    },
    delete: drop,
    sweep,
    size: () => items.size,
  };
}
