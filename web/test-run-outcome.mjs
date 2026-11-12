// Server run-close decision (M4): one terminal event, decided on close.
// Run: node --test test-run-outcome.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutcome } from "./src/lib/core/run-outcome.ts";

const base = { emittedText: true, fatalMsg: null, lastWarning: null, cleanExit: true, persists: false, wroteReport: false, tokens: 7, costUsd: 0.2, timedOut: false, killMs: 285_000 };

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

test("a warning alone never fails a clean run with output (it used to)", () => {
  const o = runOutcome({ ...base, lastWarning: "Error: could not read optional cache file" });
  assert.deepEqual(o, { type: "done", tokens: 7, costUsd: 0.2 });
});

test("control: the same clean run with a FATAL line is an error quoting the CLI", () => {
  const o = runOutcome({ ...base, fatalMsg: "Invalid API key · Please run /login" });
  assert.equal(o.type, "error");
  assert.equal(o.msg, 'The CLI reported a problem: "Invalid API key · Please run /login". This run isn\'t recorded as a confident result — fix that and re-run it.');
  // the worker card's auth hint keys on these words, so the next-step link still appears
  assert.match(o.msg.toLowerCase(), /api[ -]?key|login/);
});

test("a fatal line wins over every later gate (no output, no report, non-zero exit)", () => {
  for (const extra of [{ emittedText: false }, { persists: true, wroteReport: false }, { cleanExit: false }]) {
    assert.match(runOutcome({ ...base, ...extra, fatalMsg: "403 Forbidden" }).msg, /reported a problem: "403 Forbidden"/, JSON.stringify(extra));
  }
});

test("a timeout still wins over a fatal line", () => {
  assert.match(runOutcome({ ...base, fatalMsg: "quota exceeded", timedOut: true }).msg, /timed out/i);
});

test("a non-zero exit is still an error despite only warnings, and quotes the last warning", () => {
  const o = runOutcome({ ...base, cleanExit: false, lastWarning: "error: module not found" });
  assert.equal(o.type, "error");
  assert.match(o.msg, /hit an error before finishing/);
  assert.match(o.msg, /Last message from the CLI: "error: module not found"/);
});

test("an evaluation without a report is still an error even with no stderr at all", () => {
  assert.match(runOutcome({ ...base, persists: true, wroteReport: false }).msg, /didn't save a report/);
  // control: with the report written it is done
  assert.equal(runOutcome({ ...base, persists: true, wroteReport: true }).type, "done");
});

test("no output is still an error, warnings or not", () => {
  assert.match(runOutcome({ ...base, emittedText: false }).msg, /produced no output/);
  assert.match(runOutcome({ ...base, emittedText: false, lastWarning: "warn: x" }).msg, /produced no output/);
  assert.match(runOutcome({ ...base, emittedText: false, cleanExit: false, lastWarning: "error: boom" }).msg, /exited with an error.*Last message from the CLI: "error: boom"/);
});
