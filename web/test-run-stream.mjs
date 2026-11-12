// Terminal-state decision for the /api/run stream.
// Run: node --test test-run-stream.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { finalRunState, timeoutMessage, UNEXPECTED_END_MESSAGE } from "./src/lib/core/run-stream.ts";

const base = { sawDone: false, sawError: false, closedCleanly: true };

test("done event then clean close -> done (control)", () => {
  assert.deepEqual(finalRunState({ ...base, sawDone: true }), { status: "done" });
});

test("clean close with no done and no error -> unexpected-end error", () => {
  assert.deepEqual(finalRunState(base), { status: "error", message: "The run ended unexpectedly before finishing." });
  assert.equal(UNEXPECTED_END_MESSAGE, "The run ended unexpectedly before finishing.");
});

test("error event keeps its own message", () => {
  assert.deepEqual(finalRunState({ ...base, sawError: true, errorMessage: "quota exceeded", closedCleanly: false }), { status: "error", message: "quota exceeded" });
});

test("error event without a message falls back to 'Error'", () => {
  assert.deepEqual(finalRunState({ ...base, sawError: true }), { status: "error", message: "Error" });
});

test("precedence: error after done is an error (never bank a flagged run)", () => {
  assert.deepEqual(finalRunState({ ...base, sawDone: true, sawError: true, errorMessage: "late failure" }), { status: "error", message: "late failure" });
});

test("timeout message is plain and distinct, with singular/plural minutes", () => {
  assert.equal(timeoutMessage(285_000), "The run timed out after 5 minutes and was stopped.");
  assert.equal(timeoutMessage(720_000), "The run timed out after 12 minutes and was stopped.");
  assert.equal(timeoutMessage(60_000), "The run timed out after 1 minute and was stopped.");
  assert.notEqual(timeoutMessage(285_000), UNEXPECTED_END_MESSAGE);
});

test("timedOut flag without an event -> timeout error, not 'done'", () => {
  assert.deepEqual(finalRunState({ ...base, timedOut: true }), { status: "error", message: "The run timed out and was stopped." });
});
