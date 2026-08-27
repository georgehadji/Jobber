// @ts-check
// core/tailoring/coverage.mjs — real keyword and evidence coverage.
//
// Replaces a PHANTOM METRIC. `modes/pdf.md` step 22 and `modes/latex.md`
// step 14 both instruct the agent to report "keyword coverage %" as the final
// line of a CV generation run, and no code in the repository has ever computed
// one. An agent following those instructions literally has two options: omit
// the number the mode told it to report, or make one up. A fabricated
// percentage presented as a measurement is worse than no number at all —
// it is the exact failure this project's source-of-truth boundary exists to
// prevent, applied to the project's own output rather than to the user's CV.
//
// ── What the number means, precisely ────────────────────────────────────────
//
// Coverage answers ONE narrow question: of the keywords extracted from this
// job description, how many appear somewhere in the tailored CV? That is a
// LEXICAL fact about the document. It is emphatically NOT a claim that the
// candidate has those skills, and not a prediction of how any screen will go.
//
// This distinction is load-bearing rather than a disclaimer. A single
// percentage is trivially maximized by pasting the JD's keyword list into a
// competency grid — so a tool that reports only that number is, in effect,
// scoring keyword stuffing and calling it fit. That is also the specific
// behaviour modern ATS screening has moved AWAY from rewarding: Ashby returns
// Meets/Does-Not-Meet alongside the sentence it based the judgement on, and
// Workday's HiredScore grades against substantiating evidence. Optimizing a
// bare keyword count is optimizing for a screen that is being retired.
//
// So this module reports TWO numbers, and the second is the honest one:
//
//   coverage          — the keyword appears anywhere in the CV.
//   evidenceCoverage  — the keyword appears in a section where claims are
//                       anchored to a specific role, project, or credential
//                       (see DEFAULT_EVIDENCE_SECTIONS).
//
// A keyword found only in a skills list is `matched` but not `evidenced`. The
// gap between the two numbers is the interesting signal: it is precisely the
// set of keywords the CV asserts but does not back up, which is what a
// human reviewer probes in an interview. Every hit carries the SourceSpan it
// matched at, so the user can read the actual sentence rather than trusting
// the tally.
//
// ── Why the vocabulary is injected rather than imported ─────────────────────
//
// Alias knowledge ("k8s" and "Kubernetes" are the same skill) lives in
// skill-extract.mjs at the flat root, which exists precisely because that
// table had been copied into three files and drifted — #1851 shipped because
// a CV saying "k8s" failed to suppress a JD asking for "Kubernetes".
// core/ imports nothing outside core/ (validate-core-purity.mjs enforces it),
// so importing that module here is not an option, and copying the table in
// would recreate the drift #1896 was opened to end.
//
// The resolution is the ports-and-adapters one: this module owns the MATCHING
// ALGORITHM and takes the VOCABULARY as data. The flat-root adapter passes
// skill-extract.mjs's table in. One vocabulary, still exactly one copy of it,
// and the core stays pure and testable with a toy alias list.
//
// Pure module: no side effects, no process.exit, no I/O at import.

import { ok, err, domainError } from '../shared/result.mjs';
import { foldDiacritics } from '../shared/text.mjs';

/** Version of the coverage definition itself, so a reported number can be traced to the rules that produced it. */
export const COVERAGE_VERSION = '0.1.0';

// Sections where a keyword is attached to something checkable — a role with
// dates, a named project, a credential from an institution. A hit here is a
// claim someone could follow up on.
//
// Deliberately EXCLUDED: `skills` and `competencies` (self-asserted lists,
// which is what keyword stuffing produces) and `summary` (self-description).
// Those still count toward `coverage`; they just do not count as evidence.
//
// Keys are the canonical section keys produced by core/cv/model.mjs's
// sectionKey(). An unrecognized heading falls back to its own folded text and
// therefore is NOT evidence — failing closed, because for an unknown section
// we genuinely cannot tell whether a mention is anchored to anything. Callers
// with a CV that uses unusual headings can widen the set via options.
export const DEFAULT_EVIDENCE_SECTIONS = Object.freeze([
  'experience',
  'projects',
  'education',
  'certifications',
]);

// Bounds. Keywords originate from a job description — content the user did not
// write (TB2) — so their count and length are attacker-influenced even in the
// ordinary case of a badly-formatted posting. The modes ask for 15-20; 200
// leaves generous headroom while keeping the keyword x claim scan bounded.
const MAX_KEYWORDS = 200;
const MAX_KEYWORD_LENGTH = 80;

/**
 * @typedef {object} KeywordHit
 * @property {string} keyword      - The keyword as supplied by the caller.
 * @property {string} canonical    - Canonical form via the injected alias table.
 * @property {string} matchedText  - What actually matched in the CV — may be a
 *                                     different spelling than the keyword (JD
 *                                     said "Kubernetes", CV said "k8s").
 * @property {string} sectionKey   - Section the match was found in; 'preamble'
 *                                     or 'title' for matches above the first `## `.
 * @property {boolean} evidenced   - Whether sectionKey is an evidence section.
 * @property {import('../cv/model.mjs').SourceSpan} source
 */

/**
 * @typedef {object} KeywordMiss
 * @property {string} keyword
 * @property {string} canonical
 */

/**
 * @typedef {object} CoverageReport
 * @property {string} version           - COVERAGE_VERSION.
 * @property {number} keywords          - Distinct keywords considered (after canonical dedup).
 * @property {number} matched           - How many appear anywhere in the CV.
 * @property {number} coverage          - matched / keywords, 0..1. 0 when keywords is 0.
 * @property {number} evidenced         - How many appear in an evidence section.
 * @property {number} evidenceCoverage  - evidenced / keywords, 0..1.
 * @property {KeywordHit[]} hits
 * @property {KeywordMiss[]} misses
 */

/**
 * Escape every regex metacharacter, then allow flexible whitespace between
 * words of a multi-word keyword ("GitHub Actions" should match a line that
 * wrapped it across a newline).
 *
 * Escaping is not optional politeness: real keywords contain metacharacters
 * (`C++`, `C#`, `.NET`, `CI/CD`), and an unescaped `C++` is not just wrong but
 * an invalid quantifier that throws. Escaping first also means the resulting
 * pattern is a literal alternation with one `\s+` between words — no nested
 * quantifiers, so no catastrophic backtracking from JD-supplied text.
 *
 * @param {string} keyword
 * @returns {string}
 */
function keywordPattern(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(/\s+/g, '\\s+');
}

/**
 * `\b` is wrong at symbol edges — `\bC\+\+\b` requires a word character AFTER
 * the second `+`, so "C++" standalone never matches, and `\b\.NET` requires one
 * before the dot. Lookarounds for a word character are equivalent to `\b` at
 * word-character edges and correct at symbol edges. Same reasoning, and the
 * same fix, as skill-extract.mjs's SKILL_PATTERN.
 *
 * @param {string[]} variants
 * @returns {RegExp}
 */
function buildMatcher(variants) {
  const alternation = variants.map(keywordPattern).join('|');
  return new RegExp(`(?<!\\w)(?:${alternation})(?!\\w)`, 'i');
}

/**
 * Build forward (spelling → canonical) and reverse (canonical → spellings)
 * indexes from the injected alias pairs.
 *
 * The reverse index is what makes cross-spelling matching work in the
 * direction that actually matters here. The JD supplies the keyword and the CV
 * supplies the text, so the lookup needed is "the JD said Kubernetes; what
 * else might the CV have called it?" — which a forward canonicalize() function
 * cannot answer. Passing the pairs as data rather than a function is what
 * makes that inversion available.
 *
 * @param {Array<[string, string]>} aliases
 * @returns {{ forward: Map<string, string>, reverse: Map<string, string[]> }}
 */
function buildAliasIndex(aliases) {
  /** @type {Map<string, string>} */
  const forward = new Map();
  /** @type {Map<string, string[]>} */
  const reverse = new Map();
  for (const pair of aliases) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [spelling, canonical] = pair;
    if (typeof spelling !== 'string' || typeof canonical !== 'string') continue;
    if (!spelling || !canonical) continue;
    forward.set(spelling.toLowerCase(), canonical);
    const bucket = reverse.get(canonical.toLowerCase());
    if (bucket) bucket.push(spelling);
    else reverse.set(canonical.toLowerCase(), [spelling]);
  }
  return { forward, reverse };
}

/**
 * Flatten a CvDocument into claims tagged with the section they live in.
 *
 * Section context is the whole point — coverage.mjs needs to know not just
 * that a keyword appears but WHERE, which is what separates an evidenced hit
 * from an asserted one. core/cv/provenance.mjs walks the same tree but
 * discards section identity, so it cannot be reused here.
 *
 * @param {import('../cv/model.mjs').CvDocument} doc
 * @returns {Array<{ claim: import('../cv/model.mjs').Claim, sectionKey: string }>}
 */
function claimsWithSection(doc) {
  /** @type {Array<{ claim: import('../cv/model.mjs').Claim, sectionKey: string }>} */
  const out = [];

  /**
   * @param {import('../cv/model.mjs').Block[]} blocks
   * @param {string} key
   */
  const pushBlocks = (blocks, key) => {
    for (const block of blocks) {
      if (block.kind === 'bullets') {
        for (const item of block.items ?? []) out.push({ claim: item, sectionKey: key });
      } else if (block.claim) {
        out.push({ claim: block.claim, sectionKey: key });
      }
    }
  };

  out.push({ claim: doc.title, sectionKey: 'title' });
  pushBlocks(doc.preamble, 'preamble');
  for (const section of doc.sections) {
    out.push({ claim: section.heading, sectionKey: section.key });
    pushBlocks(section.blocks, section.key);
  }
  return out;
}

/**
 * Validate the keyword list, returning the canonical-deduped survivors.
 *
 * Strict rather than forgiving: an empty or non-string keyword means the
 * upstream extraction step produced garbage, and silently dropping it would
 * compute a percentage over a smaller denominator than the caller believes
 * they asked about — quietly inflating the number, which is the same class of
 * dishonesty this module exists to remove.
 *
 * @param {unknown} keywords
 * @param {Map<string, string>} forward
 * @returns {import('../shared/result.mjs').Result<Array<{ keyword: string, canonical: string }>, import('../shared/result.mjs').DomainError>}
 */
function validateKeywords(keywords, forward) {
  if (!Array.isArray(keywords)) {
    return err(domainError('COVERAGE_KEYWORDS_NOT_ARRAY', 'Keywords must be an array of strings.'));
  }
  if (keywords.length > MAX_KEYWORDS) {
    return err(domainError(
      'COVERAGE_TOO_MANY_KEYWORDS',
      `Too many keywords: ${keywords.length} (limit ${MAX_KEYWORDS}).`,
      { count: keywords.length, limit: MAX_KEYWORDS }
    ));
  }

  /** @type {Array<{ keyword: string, canonical: string }>} */
  const accepted = [];
  const seen = new Set();

  for (let i = 0; i < keywords.length; i++) {
    const raw = keywords[i];
    if (typeof raw !== 'string') {
      return err(domainError('COVERAGE_KEYWORD_NOT_A_STRING', `Keyword at index ${i} is not a string.`, { index: i }));
    }
    const keyword = raw.trim();
    if (!keyword) {
      return err(domainError('COVERAGE_KEYWORD_EMPTY', `Keyword at index ${i} is empty.`, { index: i }));
    }
    if (keyword.length > MAX_KEYWORD_LENGTH) {
      return err(domainError(
        'COVERAGE_KEYWORD_TOO_LONG',
        `Keyword at index ${i} exceeds ${MAX_KEYWORD_LENGTH} characters.`,
        { index: i, length: keyword.length, limit: MAX_KEYWORD_LENGTH }
      ));
    }
    // Dedup on canonical form, so a JD listing both "k8s" and "Kubernetes"
    // counts once rather than double-weighting one skill.
    const canonical = forward.get(keyword.toLowerCase()) ?? keyword;
    const dedupKey = canonical.toLowerCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    accepted.push({ keyword, canonical });
  }

  return ok(accepted);
}

/**
 * Compute real keyword and evidence coverage of a JD's keywords against a
 * parsed CV.
 *
 * @param {unknown} keywords - Keywords extracted from the JD.
 * @param {import('../cv/model.mjs').CvDocument} doc - A parsed CV (core/cv/parse.mjs).
 * @param {object} [options]
 * @param {Array<[string, string]>} [options.aliases] - [spelling, canonicalName] pairs.
 *   The flat-root adapter derives these from skill-extract.mjs. Omit for exact matching only.
 * @param {string[]} [options.evidenceSections] - Overrides DEFAULT_EVIDENCE_SECTIONS.
 * @returns {import('../shared/result.mjs').Result<CoverageReport, import('../shared/result.mjs').DomainError>}
 */
export function computeCoverage(keywords, doc, options = {}) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.sections) || !doc.title) {
    return err(domainError('COVERAGE_INVALID_DOCUMENT', 'Expected a parsed CvDocument from core/cv/parse.mjs.'));
  }

  const { forward, reverse } = buildAliasIndex(options.aliases ?? []);
  const validated = validateKeywords(keywords, forward);
  if (validated.ok === false) return validated;
  const accepted = validated.value;

  const evidenceSections = new Set(options.evidenceSections ?? DEFAULT_EVIDENCE_SECTIONS);
  const claims = claimsWithSection(doc);
  // Fold once per claim rather than once per (claim, keyword) pair — the inner
  // loop below is O(keywords x claims) and diacritic folding is the expensive
  // part of each comparison.
  const folded = claims.map((entry) => ({ ...entry, haystack: foldDiacritics(entry.claim.text) }));

  /** @type {KeywordHit[]} */
  const hits = [];
  /** @type {KeywordMiss[]} */
  const misses = [];

  for (const { keyword, canonical } of accepted) {
    // Every spelling that resolves to this canonical skill, so a JD asking for
    // "Kubernetes" is satisfied by a CV that says "k8s".
    const variants = [keyword];
    for (const spelling of reverse.get(canonical.toLowerCase()) ?? []) {
      if (!variants.some((v) => v.toLowerCase() === spelling.toLowerCase())) variants.push(spelling);
    }
    if (!variants.some((v) => v.toLowerCase() === canonical.toLowerCase())) variants.push(canonical);

    const matcher = buildMatcher(variants.map(foldDiacritics));

    /** @type {KeywordHit | null} */
    let firstAny = null;
    /** @type {KeywordHit | null} */
    let firstEvidenced = null;

    for (const entry of folded) {
      const match = matcher.exec(entry.haystack);
      if (!match) continue;
      const evidenced = evidenceSections.has(entry.sectionKey);
      /** @type {KeywordHit} */
      const hit = {
        keyword,
        canonical,
        matchedText: match[0],
        sectionKey: entry.sectionKey,
        evidenced,
        source: entry.claim.source,
      };
      if (!firstAny) firstAny = hit;
      if (evidenced) { firstEvidenced = hit; break; }
    }

    // Prefer the evidenced hit when one exists: reporting the skills-list
    // mention while a real one sits in Experience would understate the CV and
    // point the user at the least useful of the two sentences.
    const chosen = firstEvidenced ?? firstAny;
    if (chosen) hits.push(chosen);
    else misses.push({ keyword, canonical });
  }

  const total = accepted.length;
  const matched = hits.length;
  const evidenced = hits.filter((h) => h.evidenced).length;

  return ok({
    version: COVERAGE_VERSION,
    keywords: total,
    matched,
    coverage: total === 0 ? 0 : matched / total,
    evidenced,
    evidenceCoverage: total === 0 ? 0 : evidenced / total,
    hits,
    misses,
  });
}

/**
 * Format a coverage ratio as a percentage string with one decimal place.
 * Kept here rather than in the CLI so every surface reporting this number
 * rounds it the same way.
 *
 * @param {number} ratio - 0..1
 * @returns {string}
 */
export function formatPercent(ratio) {
  return `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`;
}
