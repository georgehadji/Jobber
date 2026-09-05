// tests/ats-contract-assertions.test.mjs — test-all.mjs's ATS auto-fill contract
// section asserted two runtime security guards by grepping source text with
// regexes a COMMENT satisfies (defect-hunt batch 17, B17-D1/D2).
//
// prepare-application.mjs is the prefill-only half of the never-submit
// invariant: it must refuse a non-https apply URL and refuse to read a --pdf
// from outside output/. Both guards exist and work. The section verifying them
// used:
//
//   /protocol.*https:|https:.*protocol/                     (https-only)
//   /output[^'"`\n]*startsWith|startsWith.*output|…/        (--pdf containment)
//
// Neither constrains code. Both match prose. Deleting a guard and leaving its
// comment behind kept the section green — the same "a comment satisfies the
// guard" class recorded in batches 11, 12, 14 and 15, here applied to the
// project's own security checks rather than to a test's fixtures.
//
// The fix replaced them with spawns of the real script asserting on the REASON
// it refuses. The cases below keep that honest: they prove the old regexes were
// inadequate (executably, so the record does not depend on prose), and that the
// section still runs the script rather than reading it.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntest-all.mjs ATS contract — runtime guards are executed, not grepped (B17)');

// ── The old regexes, pinned as inadequate ────────────────────────
// Kept as executable evidence: if someone reintroduces either pattern believing
// it constrains something, these say plainly that it does not.
const OLD_HTTPS_RX = /protocol.*https:|https:.*protocol/;
const OLD_PDF_RX = /output[^'"`\n]*startsWith|startsWith.*output|relative\(outputDir/;

const commentedOutGuard = '// if (u.protocol !== "https:") throw new Error("https only");';
if (OLD_HTTPS_RX.test(commentedOutGuard)) {
  pass('the old https regex matches a COMMENTED-OUT guard — it could not detect the guard being removed');
} else {
  fail('the old https regex no longer matches a commented-out guard; this record needs updating');
}

const unrelatedCode = 'const outputLabel = name.startsWith("x") ? 1 : 2;';
if (OLD_PDF_RX.test(unrelatedCode)) {
  pass('the old --pdf regex matches unrelated code — it was satisfiable without any containment guard');
} else {
  fail('the old --pdf regex no longer matches unrelated code; this record needs updating');
}

// ── The section must EXECUTE the script, not read it ─────────────
// Presence checks only: the corrected code documents the defect in comments
// that necessarily quote the old regexes, so an absence check would read its
// own subject's prose and fail (batches 11/12/14/15).
const src = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8');
const section = src.slice(
  src.indexOf('PREPARE-APPLICATION — ATS AUTO-FILL CONTRACT'),
  src.indexOf('54. _http.mjs'),
);

if (/spawnSync\(NODE, \[join\(ROOT, 'prepare-application\.mjs'\)/.test(section)) {
  pass('the ATS section spawns prepare-application.mjs rather than reading its source for guards');
} else {
  fail('the ATS section no longer runs the script — its security guards are being asserted by text again (B17-D1/D2)');
}
if (/must use https/.test(section) && /inside output\\\//.test(section)) {
  pass('both refusals are asserted on the REASON the script gives, not on the exit code alone');
} else {
  fail('the ATS section no longer matches the refusal messages — an exit code alone cannot tell the https guard from a missing fixture (B17-D1)');
}
if (/control: it does not refuse everything/.test(section)) {
  pass('a valid-input control runs, so the two refusals cannot be satisfied by a script that refuses everything');
} else {
  fail('the valid-input control is gone — both refusal assertions become satisfiable by blanket refusal');
}

// ── The no-network check still covers more than three spellings ──
if (/XMLHttpRequest/.test(section) && /axios/.test(section)) {
  pass('the no-network check covers alternative HTTP APIs, not just fetch()/https.request/createConnection');
} else {
  fail('the no-network check narrowed again — it asserts the absence of a few spellings, not of network access (B17)');
}
