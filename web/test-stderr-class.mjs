// stderr classification for /api/run: real failures vs warnings vs noise.
// Run: node --test test-stderr-class.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyStderrLine, makeLineSplitter } from "./src/lib/core/stderr-class.ts";

const expectEach = (lines, expected) => {
  for (const line of lines) assert.equal(classifyStderrLine(line), expected, line);
};

test("real failures a CLI may print while exiting 0 are fatal", () => {
  expectEach([
    "Invalid API key · Please run /login",
    "Error: 401 Unauthorized",
    "HTTP 403 Forbidden",
    "Not logged in. Please run claude login",
    "Authentication failed: token expired",
    "Your access token has expired",
    "ANTHROPIC_API_KEY is not set",
    "Missing API key",
    "Credentials not found",
    "Credit balance is too low",
    "You exceeded your current quota",
    "Rate limit exceeded",
    "permission denied while opening ~/.config/cli",
    "fatal: could not start session",
  ], "fatal");
});

test("generic noise that used to fail runs is now only a warning", () => {
  expectEach([
    "Error: could not read optional cache file",
    "warning: deprecated flag --foo",
    "module not found, falling back to bundled copy",
    "Using OAuth token from keychain",
    "Loaded credentials from ~/.config/cli",
    "Login page fetched for posting",
  ], "warning");
});

test("a retrying rate-limit or quota line is transient → warning, not fatal", () => {
  expectEach([
    "Rate limited by API, retrying in 5s",
    "429 rate limit — will retry",
    "quota pressure detected, backing off",
  ], "warning");
  // control: the same failure without a retry is fatal
  expectEach(["Rate limited by API", "429 rate limit"], "fatal");
});

test("unremarkable lines and blanks are ignored", () => {
  expectEach(["", "   ", "Compiling…", "Fetched https://example.com in 120ms"], null);
});

test("the splitter emits whole lines across chunks and flushes the tail", () => {
  const out = [];
  const s = makeLineSplitter((l) => out.push(l));
  s.push("first line\nsec");
  s.push("ond line\nthird");
  assert.deepEqual(out, ["first line", "second line"]);
  s.flush();
  assert.deepEqual(out, ["first line", "second line", "third"]);
  s.flush(); // idempotent: nothing left
  assert.deepEqual(out, ["first line", "second line", "third"]);
});

test("the splitter emits an overlong partial line early instead of buffering forever", () => {
  const out = [];
  const s = makeLineSplitter((l) => out.push(l), 10);
  s.push("abcdefghijKLMNOP");
  assert.deepEqual(out, ["abcdefghijKLMNOP"]);
  // control: under the limit it waits for the newline
  const out2 = [];
  const s2 = makeLineSplitter((l) => out2.push(l), 10);
  s2.push("abc");
  assert.deepEqual(out2, []);
});
