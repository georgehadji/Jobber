// Server run-close decision (M4): a timeout kill must get its own message.
// Run: node --test test-run-outcome.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutcome } from "./src/lib/core/run-outcome.ts";

const base = { emittedText: true, sawError: false, cleanExit: true, persists: false, wroteReport: false, tokens: 7, costUsd: 0.2, timedOut: false, killMs: 285_000 };

test("control: a clean run with output ends done and carries the cost", () => {
  assert.deepEqual(runOutcome(base), { type: "done", tokens: 7, costUsd: 0.2 });
});

test("control: a non-timeout failure keeps its generic message", () => {
  assert.match(runOutcome({ ...base, cleanExit: false }).msg, /hit an error before finishing/);
});

test("a timeout kill says it timed out, with the limit in minutes — with or without output", () => {
  for (const emittedText of [true, false]) {
    const o = runOutcome({ ...base, emittedText, cleanExit: false, timedOut: true });
    assert.equal(o.type, "error");
    assert.match(o.msg, /timed out after 5 min/i, `emittedText=${emittedText}`);
  }
  assert.match(runOutcome({ ...base, cleanExit: false, timedOut: true, killMs: 720_000 }).msg, /after 12 min/);
});

test("a timeout wins even if the process happened to exit 0 after SIGTERM", () => {
  assert.match(runOutcome({ ...base, cleanExit: true, timedOut: true }).msg, /timed out/i);
});
