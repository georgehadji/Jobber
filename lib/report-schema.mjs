// lib/report-schema.mjs — shared reader + validator for report Machine Summary
//
// Every evaluation report carries a `## Machine Summary` YAML fence. This is
// the single shared parser for it (#improvement-plan M1) — analyze-patterns,
// salary-gap, upskill and verify-pipeline each used to extract the fence with
// their own copy. It also defines + validates the `dimensions` block: the six
// scored dimensions that a global 1-5 collapses, persisted as data so
// calibration (M3) can later join predicted score to realised outcome.
//
// Pure module: no side effects, no process.exit, no I/O at import
// (#improvement-plan A7 — belongs in lib/).

import yaml from 'js-yaml';

const FENCE_RE = /##\s*Machine Summary\s*\n+```(?:yaml|yml|json)?\s*\n([\s\S]*?)\n```/i;

/** Fields the shared parser preserves (added-to over time; parsers keep the
 * subset they care about). */
export const MACHINE_SUMMARY_FIELDS = new Set([
  'company', 'role', 'score', 'legitimacy_tier', 'archetype', 'final_decision',
  'hard_stops', 'soft_gaps', 'top_strengths', 'risk_level', 'confidence',
  'next_action', 'work_auth', 'discard_reasons', 'via', 'company_confidential',
  'advertised_comp', 'risk_summary', 'dimensions', 'language_gate', 'language_note',
]);

/** Legal values of the Language Gate verdict (see modes/oferta.md). */
export const LANGUAGE_GATE_VALUES = ['pass', 'flag', 'fail'];

/** The six scored dimensions a report must carry (M1). Each entry maps to an
 * object-shaped sub-record; see validateDimensions for allowed keys. */
export const DIMENSION_KEYS = ['cv_match', 'north_star', 'comp', 'cultural', 'red_flags', 'growth'];

/**
 * Extract and parse the `## Machine Summary` YAML fence from a report body.
 *
 * @param {string} content - Full report markdown.
 * @returns {object|null} Parsed summary object, or null when absent/unparseable.
 */
export function parseReportSummary(content) {
  if (typeof content !== 'string') return null;
  const fence = content.match(FENCE_RE);
  if (!fence) return null;
  const raw = fence[1].trim();
  if (!raw) return null;
  try {
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.fromEntries(
      Object.entries(parsed).filter(([key]) => MACHINE_SUMMARY_FIELDS.has(key))
    );
  } catch {
    return null;
  }
}

/**
 * Validate a `dimensions` block against the M1 contract.
 *
 * Shape: `{ <dimension>: { score: <number 0-5>, <option fields...> } }`.
 * Returns a list of human-readable problems (empty when valid).
 *
 * @param {unknown} dimensions - The value of the summary's `dimensions` key.
 * @returns {string[]} Validation problems; empty array means valid.
 */
export function validateDimensions(dimensions) {
  const problems = [];
  if (dimensions === undefined || dimensions === null) return problems; // absent is legal (backward compat)
  if (typeof dimensions !== 'object' || Array.isArray(dimensions)) {
    return [`dimensions must be a map of dimension → record, got ${Array.isArray(dimensions) ? 'array' : typeof dimensions}`];
  }
  for (const [key, rec] of Object.entries(dimensions)) {
    if (!DIMENSION_KEYS.includes(key)) {
      problems.push(`dimensions."${key}" is not a recognised dimension (expected one of ${DIMENSION_KEYS.join(', ')})`);
      continue;
    }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      problems.push(`dimensions."${key}" must be an object record`);
      continue;
    }
    const score = rec.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 5) {
      problems.push(`dimensions."${key}".score must be a number in [0,5] (got ${JSON.stringify(score)})`);
    }
  }
  return problems;
}

/**
 * Validate a whole parsed report summary: required fields present + optional
 * `dimensions` block conforms to the contract.
 *
 * @param {object} summary - Output of parseReportSummary.
 * @returns {string[]} Problems; empty means valid.
 */
export function validateReportSummary(summary) {
  if (!summary || typeof summary !== 'object') return ['no Machine Summary parseable'];
  const problems = [];
  if (typeof summary.score !== 'number' || !Number.isFinite(summary.score) || summary.score < 0 || summary.score > 5) {
    problems.push(`score must be a number in [0,5] (got ${JSON.stringify(summary.score)})`);
  }
  if (typeof summary.legitimacy_tier !== 'string' || summary.legitimacy_tier.trim() === '') {
    problems.push('legitimacy_tier must be a non-empty string');
  }
  problems.push(...validateDimensions(summary.dimensions));
  problems.push(...validateLanguageGate(summary.language_gate));
  return problems;
}

/**
 * Validate the optional `language_gate` verdict (see modes/oferta.md's
 * Language Gate). Absent is legal — every report predating this field, and
 * every report where the user has not declared a `languages:` table, has no
 * `language_gate` key at all, exactly like `dimensions` before it.
 *
 * @param {unknown} value - The value of the summary's `language_gate` key.
 * @returns {string[]} Validation problems; empty array means valid.
 */
export function validateLanguageGate(value) {
  if (value === undefined || value === null) return []; // absent is legal (backward compat)
  if (typeof value !== 'string' || !LANGUAGE_GATE_VALUES.includes(value)) {
    return [`language_gate must be one of ${LANGUAGE_GATE_VALUES.join(', ')} (got ${JSON.stringify(value)})`];
  }
  return [];
}
