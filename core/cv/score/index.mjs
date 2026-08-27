// @ts-check
// core/cv/score/index.mjs — score a CvDocument across every registered dimension.
//
// The single entry point a caller (a CLI command, a web route, another core
// module) reaches for: run every dimension scorer, compose the result via
// rubric.mjs's documented weights, return one CvScore. Adding a fourth
// dimension later (evidence, consistency — see rubric.mjs's header) is meant
// to mean: write the scorer, register its weight in DIMENSION_WEIGHTS, add it
// to DIMENSION_SCORERS below. Nothing else in this file changes.
//
// Pure module: no side effects, no process.exit, no I/O at import.

import { composeScore } from './rubric.mjs';
import { scoreQuantification } from './quantification.mjs';
import { scoreParseability } from './parseability.mjs';
import { scoreContact } from './contact.mjs';

/** @type {((doc: import('../model.mjs').CvDocument) => import('./rubric.mjs').DimensionScore)[]} */
const DIMENSION_SCORERS = [scoreQuantification, scoreParseability, scoreContact];

/**
 * @param {import('../model.mjs').CvDocument} doc
 * @returns {import('./rubric.mjs').CvScore}
 */
export function scoreCv(doc) {
  const dimensions = DIMENSION_SCORERS.map((scorer) => scorer(doc));
  return composeScore(dimensions);
}

export { RUBRIC_VERSION, DIMENSION_WEIGHTS } from './rubric.mjs';
export { scoreQuantification } from './quantification.mjs';
export { scoreParseability } from './parseability.mjs';
export { scoreContact } from './contact.mjs';
