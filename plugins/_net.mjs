// @ts-check
// plugins/_net.mjs — SSRF egress validation for the plugin guarded fetch.
//
// Pure, side-effect-free import (no top-level work) so the engine's
// byte-identical-when-opted-out guarantee is preserved. Uses ONLY node builtins
// (node:dns, node:net) — NOT undici (Node's global fetch is powered by an
// INTERNAL undici that is not importable as the `undici` module in a zero-dep
// install, so we never depend on it).
//
// Honest scope: this resolves a hostname and rejects private/loopback/link-
// local/metadata destinations on EVERY redirect hop. It binds an HONEST plugin
// that routes through ctx.fetch. It is tamper-evidence + a footgun guard, NOT
// containment against malicious code (which can call node:net directly). A
// residual DNS-rebinding window exists because global fetch re-resolves at
// connect time; documented plainly in plugins/README.md (no overclaim).

import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isBlockedAddress } from '../lib/net-guard.mjs';

// Range rules live in lib/net-guard.mjs (shared with the ATS detector and the web
// apply driver). Kept under the old name for existing callers.
export const isBlockedIp = isBlockedAddress;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Resolve a hostname and reject if ANY resolved address is blocked. Returns the
 * validated addresses. Throws on a blocked or unresolvable host.
 * @param {string} hostname
 * @param {{ allowsLocalhost?: boolean }} [opts]
 * @returns {Promise<string[]>}
 */
export async function resolveAndValidate(hostname, { allowsLocalhost = false } = {}) {
  // An IP literal host: validate directly (no DNS).
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      if (allowsLocalhost && isLoopbackLiteral(hostname)) return [hostname];
      throw new Error(`plugin egress to ${hostname} is blocked (private/loopback/metadata range)`);
    }
    return [hostname];
  }

  if (allowsLocalhost && LOOPBACK_HOSTS.has(hostname.toLowerCase())) {
    // Local-AI providers (Ollama/LM Studio). Resolve but allow loopback through.
    return ['127.0.0.1'];
  }

  let addrs;
  try {
    addrs = await dnsLookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`plugin egress: cannot resolve ${hostname} — ${err.message}`);
  }
  if (!addrs.length) throw new Error(`plugin egress: ${hostname} resolved to no addresses`);
  for (const { address } of addrs) {
    if (isBlockedIp(address)) {
      if (allowsLocalhost && isLoopbackLiteral(address)) continue;
      throw new Error(`plugin egress: ${hostname} resolves to a blocked address (${address}) — possible SSRF/rebinding`);
    }
  }
  return addrs.map(a => a.address);
}

function isLoopbackLiteral(ip) {
  if (ip === '::1') return true;
  if (isIP(ip) === 4) return ip.split('.')[0] === '127';
  return false;
}
