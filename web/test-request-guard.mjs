// Request boundary for /api/*: DNS rebinding (Host), CSRF (Origin / Sec-Fetch-Site)
// and the JSON-only rule. Run: node --test test-request-guard.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRequest } from "./src/lib/core/request-guard.ts";

const ok = { method: "POST", host: "localhost:3000", origin: "http://localhost:3000", secFetchSite: "same-origin", contentType: "application/json" };
const run = (over, path = "/api/run", env) => checkRequest({ ...ok, ...over }, path, env);

test("control: same-origin JSON POST to a loopback host passes", () => {
  assert.equal(run({}), null);
});

test("rejects a cross-origin POST (CSRF) and names the reason", () => {
  assert.equal(run({ origin: "https://evil.example", secFetchSite: "cross-site" }), "Cross-origin request blocked");
});

test("rejects a rebound Host on GET too (DNS rebinding reads responses)", () => {
  assert.equal(run({ method: "GET", host: "evil.example:3000", origin: null }), "Host not allowed");
  assert.equal(run({ method: "GET", host: "127.0.0.1:3000", origin: null }), null); // control
});

test("rejects 0.0.0.0 and a LAN address as Host", () => {
  assert.equal(run({ host: "0.0.0.0:3000", origin: "http://0.0.0.0:3000" }), "Host not allowed");
  assert.equal(run({ host: "192.168.1.5:3000", origin: "http://192.168.1.5:3000" }), "Host not allowed");
});

test("accepts [::1] and a trailing-dot localhost", () => {
  assert.equal(run({ host: "[::1]:3000", origin: "http://[::1]:3000" }), null);
  assert.equal(run({ host: "localhost.:3000", origin: "http://localhost.:3000" }), null);
});

test("rejects a text/plain POST (the no-preflight CSRF form post)", () => {
  assert.equal(run({ contentType: "text/plain" }), "Content-Type must be application/json");
  assert.equal(run({ contentType: null }), "Content-Type must be application/json");
});

test("without Origin, Sec-Fetch-Site must be absent, same-origin or none", () => {
  assert.equal(run({ origin: null, secFetchSite: "cross-site" }), "Cross-site request blocked");
  assert.equal(run({ origin: null, secFetchSite: "same-site" }), "Cross-site request blocked");
  assert.equal(run({ origin: null, secFetchSite: null }), null); // curl / node clients
  assert.equal(run({ origin: null, secFetchSite: "none" }), null);
});

test("a malformed Origin is rejected, not ignored", () => {
  assert.equal(run({ origin: "not a url" }), "Bad Origin");
});

test("multipart is allowed only on the CV upload route", () => {
  const mp = { contentType: "multipart/form-data; boundary=x" };
  assert.equal(run(mp, "/api/cv/ingest"), null);
  assert.equal(run(mp, "/api/portals"), "Content-Type must be application/json");
});

test("multipart upload still needs a same-origin Origin", () => {
  const mp = { contentType: "multipart/form-data; boundary=x", origin: "https://evil.example" };
  assert.equal(run(mp, "/api/cv/ingest"), "Cross-origin request blocked");
});

test("JOBBER_ALLOWED_HOSTS extends the allowlist; unlisted hosts stay blocked", () => {
  const remote = { host: "box.lan:3000", origin: "http://box.lan:3000" };
  assert.equal(run(remote), "Host not allowed");
  assert.equal(run(remote, "/api/run", "box.lan"), null);
  assert.equal(run({ host: "other.lan:3000", origin: "http://other.lan:3000" }, "/api/run", "box.lan"), "Host not allowed");
});
