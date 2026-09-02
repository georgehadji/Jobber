// tests/report-schema.test.mjs — lib/report-schema.mjs (M1: dimensions contract)
import { pass, fail } from './helpers.mjs';
import {
  parseReportSummary, validateReportSummary, validateDimensions, DIMENSION_KEYS,
  validateLanguageGate, LANGUAGE_GATE_VALUES,
} from '../lib/report-schema.mjs';

console.log('\nlib/report-schema.mjs — Machine Summary parser + dimensions contract');

const GOOD_REPORT = `# 042-test

## Machine Summary

\`\`\`yaml
company: "Acme"
role: "Platform Engineer"
score: 4.2
legitimacy_tier: "High Confidence"
archetype: "AI Platform / LLMOps"
final_decision: "Apply"
risk_level: "Low"
confidence: "high"
dimensions:
  cv_match:   { score: 4.5, evidence: ["cv.md:L41"] }
  north_star: { score: 4.0, archetype: "AI Platform / LLMOps" }
  comp:       { score: 3.5, as_of: "2026-08-02", reliability: "Medium" }
  cultural:   { score: 3.0, capped: false }
  red_flags:  { score: 4.0, items: ["equity-heavy", "posting-age-47d"] }
  growth:     { score: 2.5, notes: ["few senior growth paths"] }
\`\`\`
`;

const OLD_REPORT = `# 041-old

## Machine Summary

\`\`\`yaml
company: "Beta"
role: "Designer"
score: 3.0
legitimacy_tier: "Proceed with Caution"
final_decision: "Consider"
risk_level: "Medium"
confidence: "Medium"
\`\`\`
`;

try {
  // 1. Parser extracts score + preserves the six-dimension block.
  const parsed = parseReportSummary(GOOD_REPORT);
  if (parsed && parsed.score === 4.2 && parsed.legitimacy_tier === 'High Confidence') {
    pass('parseReportSummary extracts score and legitimacy_tier');
  } else {
    fail('parseReportSummary did not parse the good report');
  }
  if (parsed && parsed.dimensions && parsed.dimensions.cv_match.score === 4.5
      && Array.isArray(parsed.dimensions.cv_match.evidence) && parsed.dimensions.cv_match.evidence[0] === 'cv.md:L41') {
    pass('parseReportSummary preserves the dimensions block and evidence anchors');
  } else {
    fail('dimensions block not preserved with evidence anchors');
  }

  // 2. Validator: good dimensions → clean; old report (no dimensions) → clean.
  if (validateReportSummary(parsed).length === 0) {
    pass('validateReportSummary accepts a conforming dimensions block');
  } else {
    fail(`validateReportSummary rejected good report: ${JSON.stringify(validateReportSummary(parsed))}`);
  }
  const old = parseReportSummary(OLD_REPORT);
  if (validateReportSummary(old).length === 0) {
    pass('validateReportSummary accepts a pre-M1 report with no dimensions (backward compat)');
  } else {
    fail(`validateReportSummary rejected old report: ${JSON.stringify(validateReportSummary(old))}`);
  }

  // 3. Validator rejects a non-conforming dimensions block.
  const bad = { ...parsed, dimensions: { ...parsed.dimensions, cmp: { score: 9 }, cv_match: { score: 5.5 } } };
  const problems = validateReportSummary(bad);
  if (problems.length === 2 && problems.some(p => p.includes('cmp')) && problems.some(p => p.includes('[0,5]'))) {
    pass('validateReportSummary flags unknown dimension keys and out-of-range scores');
  } else {
    fail(`validateReportSummary did not flag bad dimensions: ${JSON.stringify(problems)}`);
  }

  // B8-D1: a NaN top-level score must be rejected the same way an
  // out-of-range or missing one is — typeof NaN === 'number' and every NaN
  // relational comparison is false, so a bare `typeof/</> ` check alone lets
  // it through silently (validateDimensions's per-dimension check already
  // guards this with Number.isFinite; the top-level check previously didn't).
  const nanScore = validateReportSummary({ ...parsed, score: NaN });
  if (nanScore.length === 1 && nanScore[0].includes('[0,5]')) {
    pass('validateReportSummary rejects a NaN score');
  } else {
    fail(`validateReportSummary accepted a NaN score: ${JSON.stringify(nanScore)}`);
  }

  // Reachable through the real YAML fence, not just a hand-built object:
  // YAML 1.1's `.nan` literal parses to a genuine JS NaN via js-yaml.
  const nanReport = OLD_REPORT.replace(/score: [\d.]+/, 'score: .nan');
  const nanParsed = parseReportSummary(nanReport);
  if (Number.isNaN(nanParsed?.score) && validateReportSummary(nanParsed).length === 1) {
    pass('a real "score: .nan" YAML fence parses to NaN and is rejected end to end');
  } else {
    fail(`"score: .nan" fence was not rejected end to end: parsed=${JSON.stringify(nanParsed)}, problems=${JSON.stringify(validateReportSummary(nanParsed))}`);
  }

  // 4. The six dimension keys are canonically defined.
  if (DIMENSION_KEYS.length === 6 && ['cv_match', 'north_star', 'comp', 'cultural', 'red_flags', 'growth'].every(k => DIMENSION_KEYS.includes(k))) {
    pass('DIMENSION_KEYS defines the six scored dimensions');
  } else {
    fail('DIMENSION_KEYS is not the expected six-dimension set');
  }

  // 5. validateDimensions: non-map input is rejected.
  if (validateDimensions([1, 2]).length > 0 && validateDimensions('nope').length > 0) {
    pass('validateDimensions rejects non-map dimensions input');
  } else {
    fail('validateDimensions accepted a non-map value');
  }

  // 6. Language Gate: absent is legal (a pre-M-language-gate report, or a
  //    report where the user has no `languages:` table declared).
  if (validateLanguageGate(undefined).length === 0 && validateLanguageGate(null).length === 0) {
    pass('validateLanguageGate accepts an absent language_gate (backward compat)');
  } else {
    fail('validateLanguageGate rejected an absent language_gate');
  }

  // 7. Language Gate: every legal value is accepted, an illegal one is not.
  if (LANGUAGE_GATE_VALUES.every((v) => validateLanguageGate(v).length === 0)) {
    pass('validateLanguageGate accepts every legal verdict (pass/flag/fail)');
  } else {
    fail(`validateLanguageGate rejected a legal value: ${JSON.stringify(LANGUAGE_GATE_VALUES.map((v) => [v, validateLanguageGate(v)]))}`);
  }
  if (validateLanguageGate('maybe').length > 0 && validateLanguageGate(3).length > 0) {
    pass('validateLanguageGate rejects an unrecognized verdict');
  } else {
    fail('validateLanguageGate accepted an illegal verdict');
  }

  // 8. parseReportSummary preserves language_gate/language_note, and
  //    validateReportSummary flows the check end to end.
  const withLanguageGate = GOOD_REPORT.replace(
    'archetype: "AI Platform / LLMOps"',
    'archetype: "AI Platform / LLMOps"\nlanguage_gate: "flag"\nlanguage_note: "posting requires fluent English; candidate declares B1/B2"',
  );
  const parsedWithGate = parseReportSummary(withLanguageGate);
  if (parsedWithGate?.language_gate === 'flag' && /B1\/B2/.test(parsedWithGate.language_note || '')) {
    pass('parseReportSummary preserves language_gate and language_note');
  } else {
    fail(`language_gate/language_note not preserved: ${JSON.stringify(parsedWithGate)}`);
  }
  if (validateReportSummary(parsedWithGate).length === 0) {
    pass('validateReportSummary accepts a report carrying a valid language_gate');
  } else {
    fail(`validateReportSummary rejected a valid language_gate: ${JSON.stringify(validateReportSummary(parsedWithGate))}`);
  }
  const brokenGate = { ...parsedWithGate, language_gate: 'nope' };
  const gateProblems = validateReportSummary(brokenGate);
  if (gateProblems.some((p) => p.includes('language_gate'))) {
    pass('validateReportSummary flags an invalid language_gate value');
  } else {
    fail(`validateReportSummary missed an invalid language_gate: ${JSON.stringify(gateProblems)}`);
  }
} catch (e) {
  fail(`report-schema tests crashed: ${e.message}`);
}
