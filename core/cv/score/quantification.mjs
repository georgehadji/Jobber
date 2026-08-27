// @ts-check
// core/cv/score/quantification.mjs — measurable-outcome rate.
//
// Scores what fraction of "achievement bullets" (bullets inside experience or
// projects sections — the places a CV asserts what someone actually did)
// contain at least one metric claim (a percentage, a count, a multiplier, a
// currency figure) that provenance.mjs's metricClaims() can find. This reuses
// the SAME extraction verify-cv-facts.mjs already relies on for the fact
// gate, so "this bullet is quantified" and "this bullet's numbers are
// verifiable against source" are answered by literally the same function —
// no risk of the two disagreeing about what counts as a metric.
//
// Scope: summary/skills/education bullets are not counted. A skills list
// ("Python, Go, Kubernetes") is not an achievement claim and scoring it for
// quantification would reward padding a skills section with version numbers,
// not writing a stronger CV.
//
// Pure module: no side effects, no process.exit, no I/O at import.

import { metricClaims } from '../provenance.mjs';

const ACHIEVEMENT_SECTION_KEYS = new Set(['experience', 'projects']);

/**
 * @param {import('../model.mjs').CvDocument} doc
 * @returns {import('./rubric.mjs').DimensionScore}
 */
export function scoreQuantification(doc) {
  /** @type {import('../model.mjs').Claim[]} */
  const bullets = [];
  for (const section of doc.sections) {
    if (!ACHIEVEMENT_SECTION_KEYS.has(section.key)) continue;
    for (const block of section.blocks) {
      if (block.kind === 'bullets') bullets.push(...(block.items ?? []));
    }
  }

  if (bullets.length === 0) {
    return {
      key: 'quantification',
      score: 0,
      findings: ['No bullet points found under Experience or Projects — nothing to quantify.'],
      evidence: [],
    };
  }

  /** @type {import('../model.mjs').Claim[]} */
  const unquantified = [];
  let quantifiedCount = 0;
  for (const bullet of bullets) {
    if (metricClaims(bullet.text).size > 0) quantifiedCount++;
    else unquantified.push(bullet);
  }

  const score = quantifiedCount / bullets.length;
  /** @type {string[]} */
  const findings = [];
  findings.push(`${quantifiedCount} of ${bullets.length} achievement bullets include a measurable outcome (${Math.round(score * 100)}%).`);
  if (unquantified.length > 0) {
    const preview = unquantified.slice(0, 3).map((b) => `"${b.text.length > 60 ? `${b.text.slice(0, 57)}...` : b.text}"`);
    findings.push(`Unquantified: ${preview.join('; ')}${unquantified.length > 3 ? ` and ${unquantified.length - 3} more` : ''}.`);
  }

  return {
    key: 'quantification',
    score,
    findings,
    evidence: unquantified.map((b) => b.source),
  };
}
