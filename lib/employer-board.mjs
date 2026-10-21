// @ts-check
/**
 * lib/employer-board.mjs — is a job-board posting on the employer's own board?
 * (docs/FREEHIRE-INTEGRATION-PLAN.md Phase 7, ATS cross-check).
 *
 * Idea from freehire's internal/job/ghost/crosscheck.go (github.com/strelov1/
 * freehire, MIT): an aggregator posting whose role is absent from the
 * employer's own ATS board is a structural legitimacy signal. Adapted to one
 * scan run instead of freehire's stored stamps: scan.mjs fetches the tracked
 * companies' boards and the job boards in the same run, so the employer's
 * CURRENT titles are known — nothing is stored, nothing goes stale.
 *
 * Two rules carried over because they are what made the signal honest:
 *   - No coverage is not absence. A company with no board fetched this run, or
 *     a board that returned zero postings, is skipped — never flagged.
 *   - Facts, not verdicts. The result says which board was checked and how
 *     many postings it listed; it never labels the employer.
 *
 * Title matching (sameOpening) is deliberately LENIENT: role-matcher.mjs's
 * roleFuzzyMatch is the tracker's strict dedup rule, where a missed match is
 * harmless; here a missed match would report a false "not listed", so a
 * core-word containment check is OR'ed in.
 */

import { roleFuzzyMatch, SENIORITY_TOKENS } from '../role-matcher.mjs';
import { normalizeCompanyName } from './company-name.mjs';

// Title decoration boards add or drop when the same opening is syndicated.
const NOISE_TOKENS = new Set(['remote', 'hybrid', 'onsite', 'site', 'fulltime', 'full', 'time', 'parttime', 'contract',
  'temporary', 'permanent', 'all', 'genders', 'gender', 'mwd', 'fmd', 'mfd', 'wmd', 'fmx', 'mfx', 'mfdiv', 'and', 'the', 'for', 'with']);

/** @param {string} title */
function coreTokens(title) {
  return new Set(String(title || '').toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')          // (m/w/d), (Remote), [EU]
    .replace(/\s(?:[-–—|@]|at)\s.*$/, ' ')          // " - Berlin", " | Remote", " @ Acme"
    .replace(/,\s*(?:remote|hybrid|onsite|[A-Z]?[a-z]+(?:,\s*[a-z]{2,})?)$/i, ' ')
    .replace(/\b([mfwdx])\s*\/\s*([mfwdx])\s*\/\s*([mfwdx])\b/g, ' ')
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length > 1 && !NOISE_TOKENS.has(w)));
}

/**
 * Same opening on two sites? Lenient on purpose — a false "same" only
 * suppresses a "not listed" fact, while a false "different" would report one
 * that isn't true. roleFuzzyMatch (the tracker's strict dedup rule) OR one
 * title's core words contain the other's (≥2 words), with conflicting stated
 * seniority never matching.
 * @param {string} a
 * @param {string} b
 */
export function sameOpening(a, b) {
  if (roleFuzzyMatch(a, b)) return true;
  const ta = coreTokens(a);
  const tb = coreTokens(b);
  const senA = [...ta].filter((w) => SENIORITY_TOKENS.has(w));
  const senB = [...tb].filter((w) => SENIORITY_TOKENS.has(w));
  if (senA.length && senB.length && !senA.some((s) => senB.includes(s))) return false;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  const content = [...small].filter((w) => !SENIORITY_TOKENS.has(w));
  return content.length >= 2 ? content.every((w) => large.has(w)) : small.size > 0 && small.size === large.size && [...small].every((w) => large.has(w));
}

/**
 * Index tracked-company board snapshots by normalized company name. Each
 * snapshot is one tracked entry's full fetch result (BEFORE scan filters —
 * a role filtered out for the user still exists on the employer's board).
 * Keys come from the entry name and every posting's own company field.
 * @param {Array<{name: string, provider: string, jobs: Array<{title?: string, company?: string}>}>} snapshots
 * @returns {Map<string, {name: string, provider: string, titles: string[]}>}
 */
export function indexEmployerBoards(snapshots) {
  /** @type {Map<string, {name: string, provider: string, titles: string[]}>} */
  const byKey = new Map();
  for (const s of Array.isArray(snapshots) ? snapshots : []) {
    const titles = (Array.isArray(s?.jobs) ? s.jobs : [])
      .map((j) => (typeof j?.title === 'string' ? j.title.trim() : ''))
      .filter(Boolean);
    if (!titles.length) continue; // an empty board is no coverage
    const board = { name: s.name, provider: s.provider, titles };
    const keys = new Set([normalizeCompanyName(s.name || '')]);
    for (const j of s.jobs) if (typeof j?.company === 'string') keys.add(normalizeCompanyName(j.company));
    for (const key of keys) {
      if (!key) continue;
      const prev = byKey.get(key);
      // Two tracked entries for one company (e.g. two Workday sites) merge.
      byKey.set(key, prev ? { ...prev, titles: [...prev.titles, ...titles] } : board);
    }
  }
  return byKey;
}

/**
 * Cross-check job-board offers against the indexed employer boards. Sets
 * `offer.employerBoard = { listed, board, provider, postings }` on every
 * job-board offer whose company has coverage; leaves the rest untouched.
 * @param {Array<any>} offers  scan offers; only those with fromBoard === true are checked
 * @param {Map<string, {name: string, provider: string, titles: string[]}>} boards
 * @returns {{checked: number, notListed: number}}
 */
export function crossCheckEmployerBoards(offers, boards) {
  let checked = 0;
  let notListed = 0;
  for (const offer of Array.isArray(offers) ? offers : []) {
    if (!offer?.fromBoard || typeof offer.title !== 'string') continue;
    const board = boards.get(normalizeCompanyName(offer.company || ''));
    if (!board) continue;
    const listed = board.titles.some((t) => sameOpening(t, offer.title));
    offer.employerBoard = { listed, board: board.name, provider: board.provider, postings: board.titles.length };
    checked++;
    if (!listed) notListed++;
  }
  return { checked, notListed };
}
