// TS port of ../../lib/net-guard.mjs (the repo root cannot be imported from
// web/: Turbopack's root is pinned to this app). web/test-net-guard.mjs runs
// both implementations over the same address tables so they cannot drift.
// Used by the apply driver to keep the headed browser off loopback, LAN and
// cloud-metadata addresses (SSRF with screenshot read-back).

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export function normalizeHost(host: string): string {
  return String(host ?? "").trim().toLowerCase().replace(/\.+$/, "");
}

function blockedV4(o: number[]): boolean {
  const [a, b, c] = o;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function parseV6(ip: string): number[] | null {
  let s = ip.split("%")[0].toLowerCase();
  const tail = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const v4 = tail.slice(1).map(Number);
    if (v4.some((n) => n > 255)) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = s.slice(0, tail.index) + `${hi}:${lo}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 255);
  }
  return bytes;
}

/** true = never connect (also true for anything that is not an IP literal). */
export function isBlockedAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 0) return true;
  if (fam === 4) return blockedV4(ip.split(".").map(Number));
  const b = parseV6(ip);
  if (!b) return true;
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const v4At = (i: number) => blockedV4(b.slice(i, i + 4));
  if (zero(0, 12)) return b[12] === 0 && b[13] === 0 && b[14] === 0 ? true : v4At(12);
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return v4At(12);
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return v4At(12);
  if (b[0] === 0x20 && b[1] === 0x02) return v4At(2);
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true;
  if ((b[0] & 0xfe) === 0xfc) return true;
  if (b[0] === 0xff) return true;
  return false;
}

type Resolver = (host: string) => Promise<string[]>;
const dnsResolve: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/**
 * Throws unless `raw` is an http(s) URL whose host is a public name (or public
 * IP literal): no localhost / .local / .internal, and every resolved address
 * passes isBlockedAddress. A public name that later re-resolves to a private
 * address (DNS rebinding) is not caught here; the per-navigation route guard
 * re-checks each document request.
 */
export async function assertPublicWebUrl(raw: string, resolve: Resolver = dnsResolve): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("not a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("only http(s) URLs can be opened");
  const host = normalizeHost(u.hostname.replace(/^\[|\]$/g, ""));
  if (!host) throw new Error("URL has no host");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error("that address is private or reserved");
    return u;
  }
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) {
    throw new Error("that host is private or internal");
  }
  let addrs: string[];
  try {
    addrs = await resolve(host);
  } catch {
    throw new Error("could not resolve that host");
  }
  if (!addrs.length || addrs.some(isBlockedAddress)) throw new Error("that host resolves to a private or reserved address");
  return u;
}

/** Registrable-domain approximation: last two labels, three under a 2-letter ccTLD with co/com/org/net/gov/ac/edu. */
export function siteOf(urlOrHost: string): string {
  let host = urlOrHost;
  try {
    host = new URL(urlOrHost).hostname;
  } catch {
    /* already a host */
  }
  const labels = normalizeHost(host).split(".");
  if (labels.length <= 2) return labels.join(".");
  const sld = labels[labels.length - 2];
  const tld = labels[labels.length - 1];
  const take = tld.length === 2 && ["co", "com", "org", "net", "gov", "ac", "edu"].includes(sld) ? 3 : 2;
  return labels.slice(-take).join(".");
}
