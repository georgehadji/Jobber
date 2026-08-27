// @ts-check
// core/cv/score/rubric.mjs — the CV scoring contract: types, the dimension
// registry, and the composition weights.
//
// Why this exists as its own file: POLYTONIC-PLAN.md §1 makes "a published,
// reproducible scoring methodology" the actual commercial position — the thing
// that differentiates this from a category where (per the plan's own research)
// nobody publishes a validation study for their score. A methodology can only
// be published if it lives somewhere a reader can point at. This file is that
// somewhere: every weight below is data, not a number buried in a conditional
// three modules away.
//
// What this explicitly is NOT: a validated psychometric instrument. The
// weights are a documented starting point, not the output of a calibration
// study — POLYTONIC-PLAN.md §W6 (closing the loop, joining predicted score to
// realized outcome) is what would let these be tuned against real data rather
// than reasoned judgment. Selling reasoned judgment as validated science is
// exactly the credibility gap the plan's own competitive research found across
// this entire product category. RUBRIC_VERSION exists so that gap is at least
// visible: every CvScore records which version of these weights produced it,
// so a later recalibration doesn't silently invalidate scores already shown
// to a user without them being able to tell.
//
// Pure module: no side effects, no process.exit, no I/O at import.

/**
 * Bump this whenever DIMENSION_WEIGHTS, or any scoring function's logic,
 * changes in a way that would move real scores. A CvScore's rubricVersion
 * field is how a UI or an outcome record knows which rules produced it.
 */
export const RUBRIC_VERSION = '0.1.0';

/**
 * @typedef {'parseability'|'quantification'|'contact'} DimensionKey
 *
 * Three dimensions ship in this version. POLYTONIC-PLAN.md §W3 also names
 * `evidence` (claim <-> substantiating-sentence density) and `consistency`
 * (date/tense/formatting) — deferred, not silently dropped: `evidence`
 * overlaps enough with `quantification` that shipping both without real
 * differentiation would be padding the dimension count, not adding signal;
 * `consistency` needs a date-format recognizer this version does not yet
 * have. Both are tracked as W3 follow-ups.
 */

/**
 * Composition weights. Must sum to 1 — validated by rubric.test.mjs so a typo
 * here fails a test rather than silently skewing every score.
 *
 * Reasoning, so the weighting is at least inspectable even before real
 * calibration data exists:
 *   - quantification (0.45): the single strongest, most literature-cited
 *     signal for both ATS keyword/evidence matching and recruiter skim
 *     quality — an unquantified bullet ("led a team") carries far less
 *     evidence weight than a quantified one ("led a team of 5, cut deploy
 *     time 40%"). Weighted highest.
 *   - parseability (0.35): structural risk that a real ATS mis-files or
 *     drops content wholesale (unrecognized section headings, empty
 *     sections) is a harder failure than a soft quality signal — content
 *     that never gets read scores zero regardless of how good it is.
 *   - contact (0.20): closer to a completeness gate than a quality axis —
 *     a CV either has locatable contact info or it does not — so it is
 *     weighted lowest among the three while still moving the overall score
 *     meaningfully when absent.
 *
 * @type {Record<DimensionKey, number>}
 */
export const DIMENSION_WEIGHTS = {
  quantification: 0.45,
  parseability: 0.35,
  contact: 0.20,
};

/**
 * One dimension's result. `score` is normalized to [0, 1] so dimensions with
 * different natural scales (a percentage, a count, a boolean-ish check) compose
 * uniformly. `findings` are specific and actionable ("3 of 8 experience bullets
 * have no measurable outcome") rather than vague ("could be stronger") — a
 * score a user cannot act on is not worth showing.
 *
 * @typedef {object} DimensionScore
 * @property {DimensionKey} key
 * @property {number} score            - Normalized 0-1.
 * @property {string[]} findings       - Specific, human-readable observations.
 * @property {import('../model.mjs').SourceSpan[]} evidence - Spans the findings point at, where applicable.
 */

/**
 * @typedef {object} CvScore
 * @property {string} rubricVersion    - RUBRIC_VERSION at the time this was computed.
 * @property {number} overall          - Weighted composite, 0-1.
 * @property {DimensionScore[]} dimensions
 */

/**
 * Compose dimension scores into an overall CvScore using DIMENSION_WEIGHTS.
 * A dimension key with no matching weight entry is a caller bug (an
 * unregistered dimension), not a data problem — this throws rather than
 * silently treating it as zero-weighted, per §3.3: throw is for programmer
 * error, not for input that can legitimately vary.
 *
 * @param {DimensionScore[]} dimensions
 * @returns {CvScore}
 */
export function composeScore(dimensions) {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const dim of dimensions) {
    const weight = DIMENSION_WEIGHTS[dim.key];
    if (weight === undefined) {
      throw new Error(`composeScore: no weight registered for dimension "${dim.key}" — add it to DIMENSION_WEIGHTS`);
    }
    weightedSum += dim.score * weight;
    weightTotal += weight;
  }
  // weightTotal is the sum of weights for the dimensions ACTUALLY PASSED IN,
  // not necessarily all of DIMENSION_WEIGHTS — composeScore works correctly
  // when called with a subset (e.g. a future caller that only ran two of the
  // three registered dimensions), normalizing by what was actually supplied.
  const overall = weightTotal > 0 ? weightedSum / weightTotal : 0;
  return { rubricVersion: RUBRIC_VERSION, overall, dimensions };
}
