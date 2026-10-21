// @ts-check
/**
 * lib/posting-reality.mjs — structural posting-reality signals (pure).
 *
 * Port of freehire's internal/job/jobreality (github.com/strelov1/freehire,
 * MIT, commit e1a3de9 — classify.go + dictionary.go), adapted to Jobber's
 * facts-not-verdicts discipline (company-history.mjs, company-intel.mjs):
 * this module returns which independent STRUCTURAL signals fired and the
 * counts behind them, and deliberately returns NO class label. A caller can
 * report "2 of 4 signals, 1 unknown" and the evidence; it cannot print a
 * verdict it was never given.
 *
 * Pure: no I/O, no clock. The caller passes ages in days, so the result is
 * deterministic and time-dependence lives at the call site.
 *
 * Four signals (freehire's thresholds, unchanged):
 *   old           — first seen >= 90 days ago
 *   reposted      — >= 3 HISTORICAL postings of the role beyond the ones open
 *                   right now (closed and re-posted under new ids over time)
 *   massPosted    — >= 5 postings of the role open at the same time
 *   evergreenText — the description carries a curated talent-pool phrase
 * Convergence: one signal is weak; `converged` needs >= 2. Each signal is
 * true / false / null — null means "not observed", and is counted in
 * `signalsUnknown` rather than silently read as false.
 *
 * Independence rule (from freehire): the concurrent count is a subset of the
 * repost count, so it is subtracted before the repost threshold — otherwise
 * one concurrent spray of postings would fire two signals and reach
 * convergence alone. When the concurrent count is unknown the posting itself
 * (1) is subtracted, which is what freehire's arithmetic does for a role with
 * no concurrent copies.
 *
 * Also reported: `fakeFreshness` — the posting is old by first-seen age while
 * its stated posting date is within the fresh window (the source restated it).
 */

export const OLD_AGE_DAYS = 90;
export const FRESH_WINDOW_DAYS = 14;
export const REPOST_THRESHOLD = 3;
export const MASS_THRESHOLD = 5;
export const CONVERGENCE = 2;
export const SIGNAL_NAMES = Object.freeze(['old', 'reposted', 'massPosted', 'evergreenText']);

// Curated multi-word phrases marking a perpetual talent-pool listing rather
// than a specific opening. Kept multi-word on purpose so "data pipeline" or a
// lone "pool" never trips the signal — the dictionary never guesses. EN + the
// RU forms freehire ships, matched case-insensitively as substrings.
const EVERGREEN_PHRASES = Object.freeze([
  'always hiring',
  'always looking for',
  'we are always',
  "we're always",
  'talent community',
  'talent pool',
  'talent network',
  'future opportunities',
  'future openings',
  'general application',
  'open application',
  'ongoing recruitment',
  'всегда в поиске',
  'постоянно ищем',
  'постоянно в поиске',
  'кадровый резерв',
  'будущие вакансии',
]);

/**
 * Whether the text carries a curated evergreen phrase. False for anything it
 * cannot match — never inferred.
 * @param {unknown} text
 * @returns {boolean}
 */
export function hasEvergreenMarker(text) {
  if (typeof text !== 'string' || !text) return false;
  const lower = text.toLowerCase();
  return EVERGREEN_PHRASES.some((phrase) => lower.includes(phrase));
}

/** @param {unknown} v */
const count = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/**
 * @param {{ ageDays?: number|null, postedAgeDays?: number|null, repostCount?: number|null, concurrentCount?: number|null, evergreenText?: boolean|null }} input
 * @returns {{
 *   signals: { old: boolean|null, reposted: boolean|null, massPosted: boolean|null, evergreenText: boolean|null },
 *   signalCount: number, signalsUnknown: number, signalsTotal: number, converged: boolean, fakeFreshness: boolean,
 *   evidence: { ageDays: number|null, repostCount: number|null, concurrentCount: number|null, historicalReposts: number|null }
 * }}
 */
export function classifyPostingReality(input = {}) {
  const ageDays = count(input.ageDays);
  const postedAgeDays = count(input.postedAgeDays);
  const repostCount = count(input.repostCount);
  const concurrentCount = count(input.concurrentCount);
  const evergreenText = typeof input.evergreenText === 'boolean' ? input.evergreenText : null;

  const historicalReposts = repostCount === null ? null : Math.max(0, repostCount - (concurrentCount ?? 1));

  const signals = {
    old: ageDays === null ? null : ageDays >= OLD_AGE_DAYS,
    reposted: historicalReposts === null ? null : historicalReposts >= REPOST_THRESHOLD,
    massPosted: concurrentCount === null ? null : concurrentCount >= MASS_THRESHOLD,
    evergreenText,
  };
  const values = Object.values(signals);
  const signalCount = values.filter((v) => v === true).length;

  return {
    signals,
    signalCount,
    signalsUnknown: values.filter((v) => v === null).length,
    signalsTotal: SIGNAL_NAMES.length,
    converged: signalCount >= CONVERGENCE,
    fakeFreshness: signals.old === true && postedAgeDays !== null && postedAgeDays <= FRESH_WINDOW_DAYS,
    evidence: { ageDays, repostCount, concurrentCount, historicalReposts },
  };
}
