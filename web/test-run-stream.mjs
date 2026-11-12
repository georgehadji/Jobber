// Client-side run-stream lifecycle (M4): a job is `done` ONLY on an explicit `done` event.
// Run: node --test test-run-stream.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeRunStream } from "./src/lib/core/run-stream.ts";

const enc = new TextEncoder();
// Fake reader over NDJSON chunks; records whether cancel() was called.
function fakeReader(chunks) {
  const q = [...chunks];
  const r = {
    cancelled: false,
    read: async () => (q.length ? { done: false, value: enc.encode(q.shift()) } : { done: true }),
    cancel: async () => { r.cancelled = true; },
  };
  return r;
}
const ev = (o) => JSON.stringify(o) + "\n";

test("control: a stream that emits `done` ends done, and the done payload reaches the caller", async () => {
  const seen = [];
  const r = fakeReader([ev({ type: "text", text: "hi" }), ev({ type: "done", tokens: 5, costUsd: 0.1 })]);
  const end = await consumeRunStream(r, (e) => seen.push(e));
  assert.deepEqual(end, { status: "done" });
  assert.deepEqual(seen.map((e) => e.type), ["text", "done"]);
  assert.equal(seen[1].tokens, 5);
  assert.equal(r.cancelled, false, "a normal finish must not cancel the reader");
});

test("control: an event split across chunks is still parsed", async () => {
  const line = ev({ type: "done" });
  const end = await consumeRunStream(fakeReader([line.slice(0, 5), line.slice(5)]), () => {});
  assert.deepEqual(end, { status: "done" });
});

test("a clean close with NO done event is an error, not done", async () => {
  const end = await consumeRunStream(fakeReader([ev({ type: "text", text: "partial" })]), () => {});
  assert.deepEqual(end, { status: "error", label: "Run ended unexpectedly" });
});

test("an empty stream (closed immediately) is an error, not done", async () => {
  const end = await consumeRunStream(fakeReader([]), () => {});
  assert.deepEqual(end, { status: "error", label: "Run ended unexpectedly" });
});

test("an error event ends error with the server message AND cancels the reader", async () => {
  const r = fakeReader([ev({ type: "error", msg: "boom" }), ev({ type: "done" })]);
  const end = await consumeRunStream(r, () => {});
  assert.deepEqual(end, { status: "error", label: "boom" });
  assert.equal(r.cancelled, true, "early error must cancel so the server child releases the tracker-write token");
});

test("an error event without msg falls back to a generic label", async () => {
  const end = await consumeRunStream(fakeReader([ev({ type: "error" })]), () => {});
  assert.deepEqual(end, { status: "error", label: "Error" });
});
