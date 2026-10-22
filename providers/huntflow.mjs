// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Huntflow provider — Russian-market ATS whose public career sites live at
// `<tenant>.huntflow.io` (international tenants: `<tenant>.global.huntflow.io`).
// The sites are a Nuxt SSR app, so the vacancy list is served as a
// devalue-encoded `/_payload.json` (a flat array whose object/array fields are
// indices into itself). The list payload carries id, slug, position, city and
// archived_at; the description lives in a per-vacancy payload, which this port
// does not fetch (zero extra requests), so `description` is omitted.
//
// PROVENANCE: adapted from github.com/strelov1/freehire
// internal/ingest/sources/huntflow.go (MIT) — the devalue unflattener and the
// list-payload path are ported; the Go detail fan-out is dropped. Live probe
// 2026-10-21: https://tripster.huntflow.io/_payload.json → 200, 9 vacancies, no
// auth; https://thefjx.global.huntflow.io/_payload.json → 200 (global tenant).
//
// Salary: the payload's `money` is free text with no stated period, so `salary`
// is deliberately omitted (annualization rule in _types.js).

const HOST_RE = /^([a-z0-9][a-z0-9-]*)(\.global)?\.huntflow\.io$/;
// Vendor-owned labels, never a tenant board.
const RESERVED_TENANTS = new Set(['www', 'app', 'api', 'help', 'docs', 'blog', 'status']);
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}$/;

/**
 * Validate a `<tenant>[.global].huntflow.io` hostname → origin, or null.
 * @param {string} hostname
 */
function tenantOrigin(hostname) {
  const m = HOST_RE.exec(hostname);
  if (!m || RESERVED_TENANTS.has(m[1])) return null;
  return `https://${hostname}`;
}

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null} origin, e.g. https://acme.huntflow.io
 */
function resolveOrigin(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port) return null;
  return tenantOrigin(u.hostname);
}

/** @param {string} url */
function assertHuntflowUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`huntflow: invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:' || u.port || !tenantOrigin(u.hostname)) {
    throw new Error(`huntflow: untrusted URL "${url}" — must be https://<tenant>.huntflow.io/…`);
  }
  return url;
}

/**
 * Resolve a Nuxt devalue payload (flat array; object fields and array elements
 * are integer indices; a string-headed array is a type wrapper such as
 * ShallowReactive and resolves to its wrapped value) into plain nested values.
 * A reference cycle resolves to null instead of recursing forever.
 * Exported for unit tests.
 * @param {any[]} raw
 * @returns {any}
 */
export function unflattenPayload(raw) {
  if (!Array.isArray(raw)) return null;
  const memo = new Map();
  const active = new Set();
  /** @param {any} r */
  const ref = (r) => (typeof r === 'number' ? hydrate(r) : r);
  /** @param {number} i */
  function hydrate(i) {
    if (!Number.isInteger(i) || i < 0 || i >= raw.length) return null;
    if (memo.has(i)) return memo.get(i);
    if (active.has(i)) return null;
    active.add(i);
    const tok = raw[i];
    let out;
    if (Array.isArray(tok)) {
      out = typeof tok[0] === 'string' ? (tok.length > 1 ? ref(tok[1]) : null) : tok.map(ref);
    } else if (tok && typeof tok === 'object') {
      out = Object.create(null);
      for (const [k, v] of Object.entries(tok)) out[k] = ref(v);
    } else {
      out = tok;
    }
    active.delete(i);
    memo.set(i, out);
    return out;
  }
  return hydrate(0);
}

/**
 * Normalize a `_payload.json` list payload into Jobs. Archived vacancies and
 * rows without a title or a safe slug are dropped. Exported for unit tests.
 * @param {any[]} rawPayload
 * @param {string} companyName
 * @param {string} origin e.g. https://acme.huntflow.io
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseHuntflowPayload(rawPayload, companyName, origin) {
  const items = unflattenPayload(rawPayload)?.data?.vacancies?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it && !it.archived_at && String(it.position ?? '').trim() && SLUG_RE.test(String(it.slug ?? '')))
    .map((it) => ({
      title: String(it.position).trim(),
      url: `${origin}/vacancy/${it.slug}`,
      company: companyName,
      location: typeof it.city === 'string' ? it.city.trim() : '',
    }));
}

/** @type {Provider} */
export default {
  id: 'huntflow',
  scope: 'company', // one employer's own board: eligible for the employer-board cross-check

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}/_payload.json` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`huntflow: cannot derive tenant for ${entry.name}`);
    // Single request: the list payload holds the whole board (the page param is ignored).
    const raw = /** @type {any} */ (await ctx.fetchJson(assertHuntflowUrl(`${origin}/_payload.json`), { redirect: 'error' }));
    return parseHuntflowPayload(raw, entry.name, origin);
  },
};
