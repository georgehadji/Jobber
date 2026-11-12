// Interpreting POST /api/status responses so the UI never claims a refused write succeeded.
// Run: node --test test-status-write.mjs
// Before: decision-card ignored res.ok (card vanished on 409), assistant-console ignored the response
// ("Marked #n"), status-select reverted silently. Now all three go through postStatus().
import { test } from "node:test";
import assert from "node:assert/strict";
import { readStatusWriteResult, postStatus } from "./src/lib/core/status-write.ts";

const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

test("200 { ok: true } is a success (control)", async () => {
  assert.deepEqual(await readStatusWriteResult(json({ ok: true, status: "Applied" }, 200)), { ok: true });
});

test("409 terminal-state refusal keeps the server message verbatim", async () => {
  const msg = "#12 is Rejected (terminal); legal moves: Evaluated, Applied. Use --force to override.";
  assert.deepEqual(await readStatusWriteResult(json({ error: msg }, 409)), { ok: false, status: 409, message: msg });
});

test("404 not found and 423 lock timeout carry their own status and message", async () => {
  assert.deepEqual(await readStatusWriteResult(json({ error: "no tracker row 999" }, 404)), { ok: false, status: 404, message: "no tracker row 999" });
  assert.deepEqual(await readStatusWriteResult(json({ error: "tracker is locked" }, 423)), { ok: false, status: 423, message: "tracker is locked" });
});

test("non-JSON body falls back to a generic message naming the HTTP status", async () => {
  const r = await readStatusWriteResult(new Response("<html>Bad Gateway</html>", { status: 502 }));
  assert.deepEqual(r, { ok: false, status: 502, message: "Status update failed (HTTP 502)." });
});

test("empty body falls back to the generic message", async () => {
  const r = await readStatusWriteResult(new Response("", { status: 409 }));
  assert.deepEqual(r, { ok: false, status: 409, message: "Status update failed (HTTP 409)." });
});

test("JSON without a string error field falls back to the generic message", async () => {
  assert.deepEqual(await readStatusWriteResult(json({ error: 5 }, 409)), { ok: false, status: 409, message: "Status update failed (HTTP 409)." });
  assert.deepEqual(await readStatusWriteResult(json(null, 409)), { ok: false, status: 409, message: "Status update failed (HTTP 409)." });
});

test("postStatus: fetch rejection resolves to a network failure, never throws", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  try {
    assert.deepEqual(await postStatus("12", "Applied"), { ok: false, status: 0, message: "Couldn't reach the server. Status not changed." });
  } finally {
    globalThis.fetch = orig;
  }
});

test("postStatus: sends {n,status} and maps a 409 end to end; a 200 is ok (control)", async () => {
  const orig = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push([url, init.method, init.body]);
    return seen.length === 1 ? json({ error: "refused: terminal" }, 409) : json({ ok: true, status: "Applied" }, 200);
  };
  try {
    assert.deepEqual(await postStatus("7", "Applied"), { ok: false, status: 409, message: "refused: terminal" });
    assert.deepEqual(await postStatus("7", "Applied"), { ok: true });
    assert.deepEqual(seen[0], ["/api/status", "POST", JSON.stringify({ n: "7", status: "Applied" })]);
  } finally {
    globalThis.fetch = orig;
  }
});
