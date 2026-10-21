// @ts-check
// lib/net-guard.mjs — one answer to "may we connect to this address/host?".
// Pure and byte-level: IPv6 forms are parsed to 16 bytes, so every spelling of
// an address (mapped, compat, NAT64, 6to4, zero-compressed) hits the same rule.
// Used by the plugin egress guard, the URL→ATS detector and the web apply
// driver. Fail-closed: anything that does not parse as an IP is "blocked".

import { isIP } from 'node:net';

/**
 * Lowercase and drop trailing dots: `localhost.` and `localhost` are the same
 * host to the resolver, but not to a naive suffix/equality check.
 * @param {string} host
 * @returns {string}
 */
export function normalizeHost(host) {
  return String(host ?? '').trim().toLowerCase().replace(/\.+$/, '');
}

/** @param {number[]} o four octets */
function blockedV4(o) {
  const [a, b, c] = o;
  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 10) return true;                         // private
  if (a === 127) return true;                        // loopback
  if (a === 169 && b === 254) return true;           // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 192 && b === 168) return true;           // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && c === 0) return true;  // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a >= 224) return true;                         // multicast / reserved
  return false;
}

/**
 * Parse an IPv6 literal to 16 bytes, or null.
 * @param {string} ip
 * @returns {number[] | null}
 */
function parseV6(ip) {
  let s = ip.split('%')[0].toLowerCase();
  const tail = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const v4 = tail.slice(1).map(Number);
    if (v4.some((n) => n > 255)) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = s.slice(0, tail.index) + `${hi}:${lo}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...rest];
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 255);
  }
  return bytes;
}

/**
 * Is this IP literal a destination we must never connect to?
 * @param {string} ip
 * @returns {boolean} true = blocked (also true for anything that is not an IP)
 */
export function isBlockedAddress(ip) {
  const fam = isIP(ip);
  if (fam === 0) return true;
  if (fam === 4) return blockedV4(ip.split('.').map(Number));

  const b = parseV6(ip);
  if (!b) return true;
  const zero = (from, to) => b.slice(from, to).every((x) => x === 0);
  const v4At = (i) => blockedV4(b.slice(i, i + 4));

  if (zero(0, 12)) return b[12] === 0 && b[13] === 0 && b[14] === 0 ? true : v4At(12); // ::, ::1, v4-compat
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return v4At(12);               // ::ffff:a.b.c.d
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return v4At(12); // 64:ff9b::/96 NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return v4At(2);                                  // 2002::/16 6to4
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;                            // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true;                            // fec0::/10 site-local
  if ((b[0] & 0xfe) === 0xfc) return true;                                             // fc00::/7 ULA
  if (b[0] === 0xff) return true;                                                      // multicast
  return false;
}
