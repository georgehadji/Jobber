// Tests for isSubmitLabel() using Node's built-in test runner.
// Imports directly from submit-guard.ts (the single source of truth drive.ts's
// autonomous click loop uses to enforce the NEVER-SUBMIT invariant, AGENTS.md #7)
// so the test and production code can never drift out of sync.
//
// Run:  node --test test-submit-guard.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { isSubmitLabel } from "./src/lib/apply/submit-guard.ts";

// Positional order matches drive.ts's call site exactly:
// isSubmitLabel(innerText, ariaLabel, placeholder, valueAttr, nameAttr)

test("blocks a plain-text submit button", () => {
  assert.equal(isSubmitLabel("Submit Application", "", "", "", ""), true);
});

test("blocks an icon-only button whose ONLY accessible name is aria-label (#B10-D1)", () => {
  // No innerText, no value attribute — exactly what snapshot() sees on an
  // <button aria-label="Submit Application"><svg/></button>. Before the fix,
  // drive.ts's click-time check only looked at innerText/value and let this
  // click through, even though the same button was correctly labeled
  // "Submit Application" in the snapshot the planner reasoned over.
  assert.equal(isSubmitLabel("", "Submit Application", "", "", ""), true);
});

test("blocks an <input type=submit value=Enviar> via the value attribute", () => {
  assert.equal(isSubmitLabel("", "", "", "Enviar", ""), true);
});

test("blocks a control whose ONLY accessible name is the name attribute", () => {
  // <button name="submitApplication"> with no innerText/aria-label/value —
  // a narrower version of the same bypass class as #B10-D1: snapshot()
  // reads `name` as its last-resort label source, so a guard that stops at
  // aria-label/value alone still misses this one.
  assert.equal(isSubmitLabel("", "", "", "", "Submit Application"), true);
});

test("blocks a control whose ONLY accessible name is the placeholder attribute", () => {
  assert.equal(isSubmitLabel("", "", "Submit Application", "", ""), true);
});

test("does not block an ordinary Next/Continue control", () => {
  assert.equal(isSubmitLabel("Continue", "", "", "", ""), false);
  assert.equal(isSubmitLabel("", "Next page", "", "", ""), false);
  assert.equal(isSubmitLabel("", "", "", "", "nextButton"), false);
});

test("does not block an empty/absent label", () => {
  assert.equal(isSubmitLabel("", "", "", "", ""), false);
  assert.equal(isSubmitLabel(null, undefined, null, undefined, ""), false);
});
