/**
 * lib/hosted-capabilities.mjs — the hosted tier's capability boundary.
 *
 * agent-runner.mjs (the OpenRouter tool loop) and the hosted branch of
 * web/src/app/api/run/route.ts (JD fetch for evaluate) both need the SAME
 * answers to "is this path inside the workspace", "is this path writable by
 * an agent", "is this script allowed to run", and "is this URL safe to
 * fetch" — one implementation, not two that can drift (docs/HOSTED-APP-PLAN.md
 * §2.3). Pure functions only: no spawning, no process.exit, so tests can call
 * them directly instead of spawning agent-runner.mjs for every case.
 */

import { realpathSync, existsSync } from 'fs';
import { resolve, sep } from 'path';
import { pathToFileURL } from 'node:url';
import dns from 'node:dns/promises';
import { USER_PATHS } from '../update-system.mjs';

/**
 * Resolve `relPath` against `workspaceRoot` and refuse anything that escapes
 * the workspace — a `../../etc/passwd` or an absolute path pointing outside
 * it, and a symlink that resolves outside it (realpath, not just string
 * prefix matching, so a symlinked escape is caught even though we never
 * follow one on purpose).
 *
 * @param {string} workspaceRoot Absolute path to the tenant workspace.
 * @param {string} relPath Path requested by the agent (relative or absolute).
 * @returns {string} Absolute, confined path.
 * @throws {Error} When the path resolves outside the workspace.
 */
export function confinePath(workspaceRoot, relPath) {
  const root = resolve(workspaceRoot);
  const target = resolve(root, String(relPath ?? ''));
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`path escapes workspace: ${relPath}`);
  }
  // Only realpath-check what already exists — a Write to a brand-new file has
  // nothing to resolve yet, and that's fine: its resolved DIRECTORY still had
  // to pass the prefix check above.
  if (existsSync(target)) {
    const real = realpathSync(target);
    if (real !== root && !real.startsWith(root + sep)) {
      throw new Error(`path escapes workspace via symlink: ${relPath}`);
    }
  }
  return target;
}

// Trailing-slash directory entries in USER_PATHS mean "this whole subtree is
// user data"; a bare entry means exactly that one file/dir. `cv.md.bak` and
// similar backup siblings of a listed file count as user-layer too.
const USER_DIRS = USER_PATHS.filter((p) => p.endsWith('/')).map((p) => p.slice(0, -1) + '/');
const USER_FILES = new Set(USER_PATHS.filter((p) => !p.endsWith('/')));

/**
 * Whether a workspace-relative path falls in the user layer — the only place
 * the agent's Write/Edit tools may touch (§2.3: "writing modes/_shared.md or
 * a script is refused").
 *
 * @param {string} relPath Workspace-relative path, forward or back slashes.
 * @returns {boolean}
 */
export function isUserLayerPath(relPath) {
  const norm = String(relPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (USER_FILES.has(norm)) return true;
  if (USER_DIRS.some((d) => norm === d.slice(0, -1) || norm.startsWith(d))) return true;
  // A `.bak` next to a listed user file (cv.md.bak) is still user data.
  if (norm.endsWith('.bak') && USER_FILES.has(norm.slice(0, -4))) return true;
  return false;
}

/**
 * Scripts the RunScript tool may invoke, by bare basename (no `.mjs`, no
 * path) — §2.3's allowlist. Anything else is refused before it is ever
 * resolved to a path, so there is no path-confinement corner case to get
 * wrong for this one: the check is identity, not location.
 */
export const RUNSCRIPT_ALLOWLIST = [
  'reserve-report-num',
  'merge-tracker',
  'set-status',
  'generate-pdf',
  'jd-skill-gap',
  'verify-portals',
  'scan',
  'check-liveness',
  'detect-reposts',
  'stats',
  'followup-cadence',
];

/**
 * @param {string} script Requested script name, with or without `.mjs`.
 * @returns {boolean}
 */
export function isAllowedScript(script) {
  const bare = String(script ?? '').replace(/\.mjs$/, '');
  return RUNSCRIPT_ALLOWLIST.includes(bare);
}

const PRIVATE_HOST_RE = /^(127\.|10\.|192\.168\.|169\.254\.|::1$|localhost$)|^172\.(1[6-9]|2\d|3[01])\./i;

/**
 * Refuse a WebFetch target that isn't a public https:// URL — no cleartext
 * (credentials/JD text in the clear), no loopback/private-range SSRF, no
 * fetching the app's own origin back into itself.
 *
 * @param {string} url Requested URL.
 * @param {string} [ownOrigin] The app's own origin, refused as a target too.
 * @returns {URL} The parsed, approved URL.
 * @throws {Error} When the URL is missing, non-https, or targets a private range.
 */
export function assertFetchable(url, ownOrigin) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    throw new Error(`not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`refusing non-https URL: ${url}`);
  if (PRIVATE_HOST_RE.test(parsed.hostname)) throw new Error(`refusing private/loopback host: ${parsed.hostname}`);
  if (ownOrigin) {
    try {
      if (parsed.origin === new URL(ownOrigin).origin) throw new Error('refusing to fetch the app\'s own origin');
    } catch (e) {
      if (e.message.includes('own origin')) throw e;
      /* ownOrigin itself unparsable — ignore the self-fetch check */
    }
  }
  return parsed;
}

/**
 * SSRF hardening, second layer. `assertFetchable`'s PRIVATE_HOST_RE only
 * catches a private/loopback address written LITERALLY in the URL — a
 * hostname that resolves to one (a DNS A record pointed at 169.254.169.254,
 * a cloud metadata endpoint, or an internal service) sails straight through
 * it. This resolves the hostname and rejects if ANY returned address is
 * private/loopback/link-local/reserved, for IPv4 and IPv6 alike.
 *
 * // ponytail: this closes the "hostname resolves to a private IP" gap but
 * // not full DNS-rebinding (TTL=0 record that changes between this check
 * // and the actual connect a few ms later) — that needs the request pinned
 * // to the address validated here (a custom fetch dispatcher), which needs
 * // the `undici` package as an explicit dependency; not worth it for what
 * // is already a narrow, timing-dependent attack on top of a check that
 * // blocks the practical case (a static malicious record). Add the pinned
 * // dispatcher if this tool's fetch target ever stops being "whatever URL a
 * // chat turn names" and starts being something an attacker can iterate on.
 */
function isBlockedIpv4(addr) {
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // malformed → fail closed
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 — link-local, incl. cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // multicast (224+) and reserved (240+)
  return false;
}

function isBlockedIpv6(addr) {
  const norm = addr.toLowerCase();
  if (norm === '::1' || norm === '::') return true; // loopback / unspecified
  const mapped = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped ::ffff:a.b.c.d
  if (mapped) return isBlockedIpv4(mapped[1]);
  const firstGroup = norm.split(':')[0];
  if (/^f[cd]/.test(firstGroup)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(firstGroup)) return true; // fe80::/10 link-local
  return false;
}

/**
 * Resolve `hostname` and throw unless EVERY returned address is public.
 * Injectable `lookupImpl` (defaults to `dns.lookup`) so tests don't depend on
 * real DNS or the local network's address ranges.
 *
 * @param {string} hostname
 * @param {{ lookupImpl?: (hostname: string, opts: object) => Promise<{address: string, family: number}[]> }} [opts]
 * @returns {Promise<void>}
 */
export async function assertResolvesPublic(hostname, opts = {}) {
  const lookup = opts.lookupImpl ?? ((h, o) => dns.lookup(h, o));
  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (e) {
    throw new Error(`could not resolve host: ${hostname} (${e.message})`);
  }
  if (!records.length) throw new Error(`host resolved to no addresses: ${hostname}`);
  for (const { address, family } of records) {
    const blocked = family === 6 ? isBlockedIpv6(address) : isBlockedIpv4(address);
    if (blocked) throw new Error(`refusing private/loopback/reserved address: ${hostname} → ${address}`);
  }
}

const FETCH_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Strip tags/scripts/styles down to visible text — a job posting doesn't
 * need real DOM parsing, just readable prose for the model to evaluate.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MAX_REDIRECTS = 5;

/**
 * Fetch a public URL and return extracted text, capped at 2 MB of raw body.
 * The JD is DATA, never an instruction (AGENTS.md) — this returns plain text
 * for a prompt's user turn, nothing here executes anything found in it.
 *
 * `redirect: 'manual'` on purpose: `follow` would let a URL that passes every
 * check redirect straight into a private address, since only the ORIGINAL
 * URL gets validated. Each hop here is re-validated (string check + DNS
 * resolution) exactly like the first one — a redirect is not a trusted hop.
 *
 * @param {string} url
 * @param {{ ownOrigin?: string, fetchImpl?: typeof fetch, timeoutMs?: number, lookupImpl?: Parameters<typeof assertResolvesPublic>[1]['lookupImpl'] }} [opts]
 * @returns {Promise<string>}
 */
export async function fetchUrlText(url, opts = {}) {
  const doFetch = opts.fetchImpl ?? fetch;
  let current = url;
  for (let hop = 0; ; hop++) {
    if (hop > MAX_REDIRECTS) throw new Error(`too many redirects fetching ${url}`);
    const parsed = assertFetchable(current, opts.ownOrigin);
    await assertResolvesPublic(parsed.hostname, { lookupImpl: opts.lookupImpl });
    const res = await doFetch(parsed.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      headers: { 'User-Agent': 'WorklerBot/1.0 (+https://workler.org)' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), parsed.href).href;
      continue;
    }
    if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status} for ${parsed.href}`);
    const buf = await res.arrayBuffer();
    const body = Buffer.from(buf.slice(0, FETCH_MAX_BYTES)).toString('utf-8');
    const contentType = res.headers.get('content-type') || '';
    return contentType.includes('html') ? htmlToText(body) : body.trim();
  }
}

// ---------------------------------------------------------------------------
// CLI shim: `node lib/hosted-capabilities.mjs --fetch <url>` prints the
// extracted text of a public posting to stdout. web/src/lib/hosted-run.ts
// (fetchJdCached) shells out here because web/ never imports root modules.
// Guarded on argv so the module stays side-effect free for every importer;
// realpathSync for the same symlink reason as lib/llm-providers.mjs.
// ---------------------------------------------------------------------------
let invokedPath;
try { invokedPath = process.argv[1] && realpathSync(process.argv[1]); } catch { invokedPath = null; }
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const fetchFlag = process.argv.indexOf('--fetch');
  const url = fetchFlag !== -1 ? process.argv[fetchFlag + 1] : '';
  if (!url) {
    process.stderr.write('usage: node lib/hosted-capabilities.mjs --fetch <https-url>\n');
    process.exit(2);
  }
  fetchUrlText(url, { ownOrigin: process.env.WORKLER_APP_ORIGIN })
    .then((text) => { process.stdout.write(text); })
    .catch((err) => { process.stderr.write(`${err.message}\n`); process.exit(1); });
}
