// tests/core-cv-score.test.mjs — core/cv/score/* (W3: CV scoring)
//
// Three regression cases in here exist because they were REAL bugs caught by
// testing against actual fixtures while building this, not hypothetical edge
// cases invented afterward:
//   - PHONE_RE originally matched a CV date range "(2020-2024)" as a phone
//     number, because its separator between digit groups was optional, which
//     let regex backtracking carve any unbroken digit run into fake "groups".
//   - The link detector originally excluded a claim from being searched for a
//     link merely because it ALSO contained the found email — which breaks on
//     examples/cv-example.md, where the email and LinkedIn URL are the same
//     merged paragraph (consecutive contact lines with no blank separator).
//   - Even with that exclusion removed, a non-global link match on that same
//     merged claim finds "example.com" (the email's own domain, matched
//     starting right after the '@') before ever reaching the real LinkedIn
//     URL later in the string.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pass, fail } from './helpers.mjs';
import { parseCvMarkdown } from '../core/cv/parse.mjs';
import { RUBRIC_VERSION, DIMENSION_WEIGHTS, composeScore } from '../core/cv/score/rubric.mjs';
import { scoreQuantification } from '../core/cv/score/quantification.mjs';
import { scoreParseability } from '../core/cv/score/parseability.mjs';
import { scoreContact } from '../core/cv/score/contact.mjs';
import { scoreCv } from '../core/cv/score/index.mjs';

console.log('\ncore/cv/score/* — CV scoring (W3)');

/** @param {string} md */
const parse = (md) => {
  const r = parseCvMarkdown(md);
  if (!r.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(r.error)}`);
  return r.value;
};

try {
  // --- rubric.mjs -----------------------------------------------------

  // 1. Weights sum to 1 — a typo here would silently skew every score.
  const weightSum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
  if (Math.abs(weightSum - 1) < 1e-9) pass('DIMENSION_WEIGHTS sums to exactly 1');
  else fail(`DIMENSION_WEIGHTS sums to ${weightSum}, not 1`);

  // 2. composeScore is a real weighted average, not a plain mean.
  const composed = composeScore([
    { key: 'quantification', score: 1, findings: [], evidence: [] },
    { key: 'parseability', score: 0, findings: [], evidence: [] },
    { key: 'contact', score: 0, findings: [], evidence: [] },
  ]);
  const expected = 1 * DIMENSION_WEIGHTS.quantification;
  if (Math.abs(composed.overall - expected) < 1e-9) pass('composeScore applies DIMENSION_WEIGHTS, not a plain average');
  else fail(`composeScore: got ${composed.overall}, expected ${expected}`);

  // 3. Every CvScore carries the rubric version it was computed under.
  if (composed.rubricVersion === RUBRIC_VERSION) pass('composeScore stamps the current RUBRIC_VERSION');
  else fail(`rubricVersion: ${composed.rubricVersion}`);

  // 4. An unregistered dimension key is a programmer error — throws, per
  //    §3.3 (throw is for contract violations, not user-caused variation).
  try {
    composeScore([{ key: /** @type {any} */ ('not-a-real-dimension'), score: 1, findings: [], evidence: [] }]);
    fail('composeScore did not throw on an unregistered dimension key');
  } catch {
    pass('composeScore throws on an unregistered dimension key');
  }

  // 5. composeScore normalizes correctly over a SUBSET of dimensions, not
  //    just all three — a caller passing two of three still gets a sane average.
  const partial = composeScore([
    { key: 'quantification', score: 1, findings: [], evidence: [] },
    { key: 'contact', score: 1, findings: [], evidence: [] },
  ]);
  if (Math.abs(partial.overall - 1) < 1e-9) pass('composeScore normalizes correctly over a subset of dimensions');
  else fail(`partial composeScore: ${partial.overall}`);

  // --- quantification.mjs ----------------------------------------------

  // 6. A CV with fully-quantified bullets scores 1.
  const allQuantified = parse('# T\n\n## Experience\n### Role -- Co (2020-2024)\n- Grew revenue 40%.\n- Led a team of 12 engineers.\n');
  const q1 = scoreQuantification(allQuantified);
  if (q1.score === 1) pass('quantification scores 1.0 when every achievement bullet has a metric');
  else fail(`fully-quantified score: ${q1.score}`);

  // 7. A CV with zero quantified bullets scores 0, with actionable findings.
  const noneQuantified = parse('# T\n\n## Experience\n### Role -- Co (2020-2024)\n- Did good work.\n- Helped the team.\n');
  const q2 = scoreQuantification(noneQuantified);
  if (q2.score === 0 && q2.findings.some((f) => f.includes('0 of 2'))) pass('quantification scores 0.0 and reports it specifically, not vaguely');
  else fail(`unquantified: ${JSON.stringify(q2)}`);

  // 8. Skills/education bullets are NOT counted — a version-numbers-in-skills
  //    trick must not inflate this score.
  const skillsOnly = parse('# T\n\n## Skills\n- Python 3.12\n- Kubernetes 1.28\n');
  const q3 = scoreQuantification(skillsOnly);
  if (q3.score === 0 && q3.findings.some((f) => f.includes('No bullet points found'))) {
    pass('quantification ignores Skills-section bullets entirely (no scoreable achievement content)');
  } else {
    fail(`skills-only: ${JSON.stringify(q3)}`);
  }

  // 9. Real fixture sanity: the canonical CV's known 4-of-6 quantified rate.
  const canonicalPath = fileURLToPath(new URL('../test-fixtures/upgrade/state-v1.18/cv.md', import.meta.url));
  const canonical = parse(readFileSync(canonicalPath, 'utf8'));
  const q4 = scoreQuantification(canonical);
  if (Math.abs(q4.score - 4 / 6) < 1e-9) pass('quantification on the canonical fixture matches the hand-verified 4-of-6 rate');
  else fail(`canonical fixture quantification: ${q4.score} (expected ${4 / 6})`);

  // --- parseability.mjs --------------------------------------------------

  // 10. Standard section headings score full marks.
  const standard = parse('# T\n\n## Summary\nx\n\n## Experience\n- y\n');
  const p1 = scoreParseability(standard);
  if (p1.score === 1) pass('parseability scores 1.0 for standard, non-empty sections');
  else fail(`standard headings: ${p1.score} — ${JSON.stringify(p1.findings)}`);

  // 11. An unrecognized heading is penalized and named specifically.
  const weird = parse('# T\n\n## Hobbies and Interests\n- x\n\n## Experience\n- y\n');
  const p2 = scoreParseability(weird);
  if (p2.score < 1 && p2.findings.some((f) => f.includes('Hobbies and Interests'))) {
    pass('parseability penalizes an unrecognized section heading and names it');
  } else {
    fail(`unrecognized heading: ${JSON.stringify(p2)}`);
  }

  // 12. An empty section (heading, no content) is flagged.
  const emptySection = parse('# T\n\n## Summary\nx\n\n## Certifications\n\n## Experience\n- y\n');
  const p3 = scoreParseability(emptySection);
  if (p3.score < 1 && p3.findings.some((f) => f.includes('Certifications'))) {
    pass('parseability flags a section with a heading but no content');
  } else {
    fail(`empty section: ${JSON.stringify(p3)}`);
  }

  // 13. No Summary/Experience at all is a severe penalty.
  const noCore = parse('# T\n\n## Skills\n- Python\n');
  const p4 = scoreParseability(noCore);
  if (p4.score < 0.7 && p4.findings.some((f) => f.includes('No "Summary" or "Experience"'))) {
    pass('parseability heavily penalizes a CV with no Summary or Experience section');
  } else {
    fail(`no-core-section: ${JSON.stringify(p4)}`);
  }

  // 14. Score never goes negative even with many stacked penalties.
  const worstCase = parse('# T\n\n## Weird One\n\n## Weird Two\n\n## Weird Three\n- ' + 'x'.repeat(500) + '\n');
  const p5 = scoreParseability(worstCase);
  if (p5.score >= 0 && p5.score <= 1) pass('parseability score stays clamped to [0, 1] under many stacked penalties');
  else fail(`worst-case score out of range: ${p5.score}`);

  // --- contact.mjs (the three real bugs) ---------------------------------

  // 15. REGRESSION: a bare year range must NOT be detected as a phone number.
  const dateRangeCv = parse('# T\n\n## Summary\nLed the ML platform at a fintech (2020-2024), scaling rapidly.\n');
  const c1 = scoreContact(dateRangeCv);
  if (!c1.findings.some((f) => f.includes('phone number also found'))) {
    pass('REGRESSION: a "(2020-2024)" date range is not mistaken for a phone number');
  } else {
    fail(`date range falsely detected as phone: ${JSON.stringify(c1)}`);
  }

  // 16. A real phone number is still detected.
  const withPhone = parse('# T\n\n**Phone:** 512-555-1234\n\n## Summary\nx\n');
  const c2 = scoreContact(withPhone);
  if (c2.findings.some((f) => f.includes('phone number also found'))) {
    pass('a real phone number (512-555-1234) is still correctly detected');
  } else {
    fail(`real phone not detected: ${JSON.stringify(c2)}`);
  }

  // 17. REGRESSION: a link in the SAME merged claim as the email is found,
  //     not skipped because "that claim already matched the email".
  const example = parse(readFileSync(fileURLToPath(new URL('../examples/cv-example.md', import.meta.url)), 'utf8'));
  const c3 = scoreContact(example);
  if (c3.score === 1 && c3.findings.some((f) => f.includes('profile or portfolio link also found'))) {
    pass('REGRESSION: a LinkedIn link merged into the same claim as the email is found');
  } else {
    fail(`cv-example.md contact score: ${JSON.stringify(c3)}`);
  }

  // 18. REGRESSION: the email's OWN domain must not be reported as a
  //     separate "link found" when no other link actually exists.
  const emailOnly = parse('# T\n\n**Email:** alex@example.com\n\n## Summary\nx\n');
  const c4 = scoreContact(emailOnly);
  if (c4.score === 0.6 && !c4.findings.some((f) => f.includes('link also found'))) {
    pass("REGRESSION: an email's own domain is not double-counted as a separate link");
  } else {
    fail(`email-only contact score: ${JSON.stringify(c4)}`);
  }

  // 19. No contact info at all scores 0 with an actionable finding.
  const noContact = parse('# T\n\n## Summary\nJust some prose with no reachable info at all.\n');
  const c5 = scoreContact(noContact);
  if (c5.score === 0 && c5.findings.some((f) => f.includes('No email address found'))) {
    pass('a CV with zero contact info scores 0.0 with a specific finding');
  } else {
    fail(`no-contact score: ${JSON.stringify(c5)}`);
  }

  // --- index.mjs (composition end-to-end) --------------------------------

  // 20. scoreCv on a real fixture: bounds check plus dimension coverage.
  const full = scoreCv(canonical);
  const dimKeys = full.dimensions.map((d) => d.key).sort().join(',');
  if (full.overall >= 0 && full.overall <= 1 && dimKeys === 'contact,parseability,quantification') {
    pass('scoreCv composes all three dimensions into a bounded overall score');
  } else {
    fail(`scoreCv: overall=${full.overall}, dims=${dimKeys}`);
  }

  // 21. Every dimension's evidence spans (where present) are valid — this is
  //     what lets a UI point at exactly the line a finding is about.
  let allEvidenceValid = true;
  for (const dim of full.dimensions) {
    for (const span of dim.evidence) {
      if (!(span.line > 0) || typeof span.text !== 'string') allEvidenceValid = false;
    }
  }
  if (allEvidenceValid) pass('every dimension\'s evidence spans are valid SourceSpans');
  else fail('some evidence spans were malformed');

  // 22. REGRESSION (ReDoS): scoring a large document must stay linear.
  //     contact.mjs's EMAIL_RE and LINK_RE were both quadratic on input with
  //     no '@' and no '.' — the leading unbounded quantifier matched to the end
  //     of the string, failed, and backtracked once per starting position.
  //     Measured on a run of 'x': EMAIL 139ms at 10k rising to 8678ms at 80k
  //     (4x per doubling); LINK 219ms rising to 11186ms. At the ingest
  //     adapter's 256KB ceiling that was a ~2-minute hang, and it is how the
  //     bug surfaced — as a 120s test timeout, visible only in the parallel
  //     runner. Bounding every quantifier to its real RFC/DNS limit made both
  //     linear. This asserts the shape of the curve, not a wall-clock budget:
  //     an 8x input increase must not produce a superlinear time increase.
  const scaleFor = (n) => {
    const header = '# T\n\n## S\n';
    const doc = parseCvMarkdown(header + 'x'.repeat(n));
    if (!doc.ok) throw new Error('perf fixture failed to parse');
    const t = Date.now();
    scoreCv(doc.value);
    return Date.now() - t;
  };
  const small = Math.max(1, scaleFor(10_000));
  const large = Math.max(1, scaleFor(80_000));
  // Quadratic would be ~64x for an 8x input growth; linear ~8x. A generous 20x
  // ceiling separates the two decisively without being flaky on a loaded runner.
  if (large / small < 20) {
    pass(`scoring scales sub-quadratically with input size (8x input -> ${(large / small).toFixed(1)}x time)`);
  } else {
    fail(`scoring looks superlinear: 10k=${small}ms, 80k=${large}ms (${(large / small).toFixed(1)}x for 8x input)`);
  }

  // 23. Determinism: scoring the same document twice gives byte-identical
  //     JSON output — the reproducibility property the whole rubric depends on.
  const run1 = JSON.stringify(scoreCv(canonical));
  const run2 = JSON.stringify(scoreCv(canonical));
  if (run1 === run2) pass('scoreCv is deterministic — identical input produces byte-identical output');
  else fail('scoreCv produced different output on identical input');
} catch (e) {
  fail(`core-cv-score tests crashed: ${e.message}\n${e.stack}`);
}
