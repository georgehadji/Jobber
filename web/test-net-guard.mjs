// Destination guard of the apply driver. The TS port must agree with the repo's
// lib/net-guard.mjs on every address (drift would silently re-open a hole), and
// assertPublicWebUrl must reject private targets before the browser is opened.
// Run: node --test test-net-guard.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress, assertPublicWebUrl, siteOf, normalizeHost } from "./src/lib/net-guard.ts";
import { isBlockedAddress as rootBlocked } from "../lib/net-guard.mjs";

const BLOCKED = [
  "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "0.0.0.0", "224.0.0.1",
  "::", "::1", "fe80::1", "fec0::1", "fd00::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::127.0.0.1",
  "64:ff9b::7f00:1", "2002:7f00:1::1", "2002:a9fe:a9fe::", "not-an-ip",
];
const ALLOWED = ["8.8.8.8", "1.1.1.1", "198.20.0.1", "2606:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"];

test("the TS port blocks every blocked address and allows every public one", () => {
  for (const ip of BLOCKED) assert.equal(isBlockedAddress(ip), true, `blocks ${ip}`);
  for (const ip of ALLOWED) assert.equal(isBlockedAddress(ip), false, `allows ${ip}`);
});

test("the TS port and lib/net-guard.mjs agree on every address", () => {
  for (const ip of [...BLOCKED, ...ALLOWED, "172.32.0.1", "100.128.0.1", "192.0.0.5", "fe00::1", "2001:db8::1"]) {
    assert.equal(isBlockedAddress(ip), rootBlocked(ip), ip);
  }
});

const never = async () => {
  throw new Error("resolver must not be called");
};
const pub = async () => ["93.184.216.34"];
const priv = async () => ["10.0.0.5"];

test("assertPublicWebUrl rejects literals and internal names without resolving", async () => {
  for (const u of ["http://127.0.0.1/", "http://localhost./", "https://[::1]/", "http://169.254.169.254/latest", "https://intranet/", "https://printer.lan./", "https://x.internal/"]) {
    await assert.rejects(assertPublicWebUrl(u, never), undefined, u);
  }
});

test("assertPublicWebUrl rejects a public-looking name that resolves private, and non-http schemes", async () => {
  await assert.rejects(assertPublicWebUrl("https://jobs.evil.example/apply", priv), /private or reserved/);
  await assert.rejects(assertPublicWebUrl("file:///etc/passwd", never), /only http/);
  await assert.rejects(assertPublicWebUrl("javascript:alert(1)", never));
});

test("control: a public name and a public IP literal pass", async () => {
  assert.equal((await assertPublicWebUrl("https://boards.greenhouse.io/acme/jobs/1", pub)).hostname, "boards.greenhouse.io");
  assert.equal((await assertPublicWebUrl("https://example.com./x", pub)).protocol, "https:");
  assert.equal((await assertPublicWebUrl("http://8.8.8.8/", never)).hostname, "8.8.8.8");
});

test("siteOf groups subdomains and keeps ccTLD second levels", () => {
  assert.equal(siteOf("https://job-boards.greenhouse.io/x"), "greenhouse.io");
  assert.equal(siteOf("https://boards.greenhouse.io/x"), "greenhouse.io");
  assert.equal(siteOf("https://careers.example.co.uk/a"), "example.co.uk");
  assert.notEqual(siteOf("https://evil.example/"), siteOf("https://greenhouse.io/"));
  assert.equal(normalizeHost("Example.COM."), "example.com");
});
