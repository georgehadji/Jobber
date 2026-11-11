// Status writes must report failure honestly (STATE-MACHINES-PLAN M2 / Phase 2.1).
// postStatus() is the single response->result mapping used by decision-card, status-select and the
// assistant console; dispatch(setStatus) is the assistant's confirm path. No DOM is available (no
// new deps), so we drive the shared logic with a mocked fetch / ctx instead of rendering.
//
// Run:  node --test test-status-write.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { postStatus } from "./src/lib/status-write.ts";
import { dispatch } from "./src/app/actions/registry.ts";

const json = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("control: a 200 response is a success and posts {n,status} to /api/status", async () => {
  let seen;
  const r = await postStatus("12", "Applied", async (url, init) => {
    seen = { url, method: init.method, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ ok: true, status: "Applied" }), { status: 200 });
  });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(seen, { url: "/api/status", method: "POST", body: { n: "12", status: "Applied" } });
});

for (const [code, msg] of [
  [409, "refused: Hired is terminal"],
  [404, "no tracker row #12"],
  [423, "tracker is locked"],
]) {
  test(`${code} is a failure carrying the server's own message`, async () => {
    const r = await postStatus("12", "Applied", json(code, { error: msg }));
    assert.equal(r.ok, false, `HTTP ${code} must not be reported as success`);
    assert.equal(r.error, msg);
  });
}

test("a non-JSON error body still fails, with the HTTP code in the message", async () => {
  const r = await postStatus("12", "Applied", async () => new Response("<html>boom</html>", { status: 500 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /500/);
});

test("a network failure is a failure, not a throw", async () => {
  const r = await postStatus("12", "Applied", async () => {
    throw new TypeError("fetch failed");
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /network/i);
});

// ── assistant confirm path ────────────────────────────────────────────────────────────────────
const baseCtx = (writeStatus) => ({ applications: [{ n: "12", company: "Acme", role: "Engineer" }], writeStatus });

async function confirmRun(writeStatus) {
  const res = dispatch("setStatus", { n: "12", status: "applied" }, baseCtx(writeStatus));
  assert.equal(res.status, "confirm", "setStatus must ask for confirmation first");
  return res.run();
}

test("control: confirmed setStatus claims 'Marked' only when the write succeeded", async () => {
  const calls = [];
  const info = await confirmRun(async (n, s) => (calls.push([n, s]), { ok: true }));
  assert.deepEqual(calls, [["12", "Applied"]]);
  assert.equal(info.note, "Marked #12 as Applied.");
  assert.equal(info.error, undefined);
});

test("confirmed setStatus on a refused write reports the server message and never says 'Marked'", async () => {
  const info = await confirmRun(async () => ({ ok: false, error: "refused: Hired is terminal" }));
  assert.match(info.error ?? "", /refused: Hired is terminal/);
  assert.doesNotMatch(JSON.stringify(info), /Marked/);
});
