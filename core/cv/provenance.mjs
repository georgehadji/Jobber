// @ts-check
// core/cv/provenance.mjs — claim extraction and source-backing checks.
//
// The metric/fact extraction logic (stripMarkup, normalizeClaim, metricClaims,
// factClaims and their supporting tables) is ported verbatim from
// verify-cv-facts.mjs, which already implements it correctly and is exercised
// by its own test suite (verify-cv-facts.mjs --self-test). Nothing about the
// matching rules changes here — same patterns, same noun list, same synonym
// map — only the home changes: this is now a pure core module with zero I/O,
// so it composes with parse.mjs instead of only running as a CLI gate.
//
// What IS new: verify-cv-facts.mjs works over two raw text blobs (a generated
// document, cv.md) and returns a Set<string> of claims with no positional
// information — it can say a claim is unsupported, but not point at where in
// the source it should have come from. Once cv.md is a CvDocument (W1), every
// bullet and paragraph already carries a SourceSpan from parsing. So
// extractDocumentMetrics/extractDocumentFacts below attribute each claim found
// in the CV to the EXACT block it came from, and checkProvenance uses that to
// answer not just "is this backed" but "backed by what, exactly" — which is
// the mechanism POLYTONIC-PLAN.md §3.5 and §4.3 both depend on: a provenance
// receipt (§W8.1) needs the source location to point at; the prompt-injection
// defense (§4.3 — "a generated claim with no source span is dropped") needs
// something to check the drop condition against.
//
// Pure module: no side effects, no process.exit, no I/O at import.

import { ok } from '../shared/result.mjs';

// ---------------------------------------------------------------------------
// Ported verbatim from verify-cv-facts.mjs (see file header above).
// ---------------------------------------------------------------------------

const TOOL_PROSE_WORDS = new Set([
  'a', 'an', 'and', 'at', 'built', 'by', 'containerized', 'deployment',
  'deployments', 'for', 'from', 'in', 'of', 'on', 'production', 'project',
  'team', 'the', 'to', 'using', 'with',
]);
const TOOL_PHRASE_PATTERN = /^(?=.{1,80}$)[\p{L}\p{N}.][\p{L}\p{N}+#./-]*(?:\s+[\p{L}\p{N}.][\p{L}\p{N}+#./-]*){0,2}$/u;
const METRIC_NOUNS = [
  'users', 'customers', 'clients', 'employees', 'engineers', 'teams', 'companies',
  'partners', 'organizations', 'organisations', 'brands', 'countries',
  'hours', 'days', 'weeks', 'months', 'years', 'minutes', 'seconds',
  'requests', 'tokens', 'documents', 'workflows', 'pipelines', 'agents',
  'interviews', 'applications', 'offers', 'reports', 'cvs', 'resumes',
  'enrollments', 'enrolments', 'completions', 'courses', 'certifications',
  'certificates', 'sessions', 'responses', 'surveys', 'cohorts',
  'commits', 'contributions', 'repositories', 'repos', 'modules', 'tools',
  'servers', 'guides', 'articles', 'datasets', 'examples', 'deployments',
  'services', 'downloads', 'stars', 'lines', 'projects', 'integrations', 'tests',
];
const COUNT_CLAIM_RE = new RegExp(
  String.raw`\b(\d[\d,.]*)\s*\+?\s*(?:[A-Za-z][A-Za-z-]*\s+){0,2}(${METRIC_NOUNS.join('|')})\b`,
  'gi'
);
const NOUN_SYNONYMS = new Map([
  ['repos', 'repositories'],
  ['enrolments', 'enrollments'],
  ['organisations', 'organizations'],
  ['cvs', 'resumes'],
  ['certificates', 'certifications'],
  ['articles', 'guides'],
]);
const SIMPLE_CLAIM_PATTERNS = [
  /\b\d+(?:\.\d+)?\s?%/g,
  /(?<![\w$€£])[$€£]\s?\d[\d,.]*(?:\s?[kKmMbB])?/g,
  /\b\d+(?:\.\d+)?\s?x\b/gi,
];

/** Remove HTML, basic LaTeX commands, and excess whitespace from document text. */
/** @param {string} text @returns {string} */
export function stripMarkup(text) {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<\/?[a-zA-Z][^>\n]*>/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^}]*)\})?/g, ' $1 ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a claim for case- and whitespace-insensitive comparison. */
/** @param {string} claim @returns {string} */
export function normalizeClaim(claim) {
  return claim.toLowerCase().replace(/[,\s]+/g, ' ').trim();
}

/** Normalize a non-metric fact and remove terminal punctuation. */
/** @param {string} value @returns {string} */
function normalizeFact(value) {
  return normalizeClaim(value).replace(/[.;:,]+$/g, '').trim();
}

/** Keep likely technology names while dropping ordinary prose fragments. */
/** @param {string} value @returns {boolean} */
function isLikelyTool(value) {
  const normalized = normalizeFact(value);
  const words = normalized.split(' ');
  if (!normalized || words.length > 3 || words.some((/** @type {string} */ word) => TOOL_PROSE_WORDS.has(word))) return false;
  return TOOL_PHRASE_PATTERN.test(value.trim());
}

/**
 * Extract metric-like claims (percentages, currency amounts, multipliers,
 * counted nouns) that require source evidence.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function metricClaims(text) {
  const clean = stripMarkup(text);
  const claims = new Set();
  for (const pattern of SIMPLE_CLAIM_PATTERNS) {
    for (const match of clean.matchAll(pattern)) claims.add(normalizeClaim(match[0]));
  }
  COUNT_CLAIM_RE.lastIndex = 0;
  for (const match of clean.matchAll(COUNT_CLAIM_RE)) {
    const noun = match[2].toLowerCase();
    claims.add(normalizeClaim(`${match[1]} ${NOUN_SYNONYMS.get(noun) ?? noun}`));
  }
  return claims;
}

/**
 * Extract explicitly asserted employer, title, and tool claims from text.
 *
 * @param {string} text
 * @returns {{ kind: 'employer'|'title'|'tool', value: string }[]}
 */
export function factClaims(text) {
  const clean = stripMarkup(text);
  /** @type {{ kind: 'employer'|'title'|'tool', value: string }[]} */
  const claims = [];
  /** @type {['employer'|'title'|'tool', RegExp][]} */
  const patterns = [
    ['employer', /\b(?:worked at|joined|employer\s*:\s*|company\s*:\s*)\s*([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/g],
    ['title', /\b(?:served as|worked as|title\s*:\s*|role\s*:\s*)\s*(?:an?\s+|the\s+)?([A-Z][\w/-]*(?:\s+[A-Z][\w/-]*){0,4})|\b(?:worked at|joined)\s+[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4}\s+as\s+(?:an?\s+|the\s+)?([A-Z][\w/-]*(?:\s+[A-Z][\w/-]*){0,4})/g],
    ['tool', /\b(?:using|built with|worked with|technologies?\s*:\s*|tech stack\s*:\s*)([^.;\n]+?)(?=\s+\bfor\b|[.;\n]|$)/gi],
  ];
  for (const [kind, pattern] of patterns) {
    for (const match of clean.matchAll(pattern)) {
      const rawText = kind === 'tool' ? match[1].trim() : '';
      const rawValues = kind === 'tool'
        ? (/^the\s+/i.test(rawText) ? [] : rawText.split(/,|\band\b|\bwith\b|\bin\b/i))
        : [match[1] || match[2]];
      for (const raw of rawValues) {
        const value = normalizeFact(raw);
        if (value && (kind !== 'tool' || isLikelyTool(raw))) claims.push({ kind, value });
      }
    }
  }
  return claims;
}

// ---------------------------------------------------------------------------
// New: document-level extraction with provenance (needs a parsed CvDocument,
// which is why this could not exist before parse.mjs did).
// ---------------------------------------------------------------------------

/**
 * @param {import('./model.mjs').CvDocument} doc
 * @returns {import('./model.mjs').Claim[]}
 */
function allTextClaims(doc) {
  /** @type {import('./model.mjs').Claim[]} */
  const claims = [];
  const collectBlocks = (/** @type {import('./model.mjs').Block[]} */ blocks) => {
    for (const block of blocks) {
      if (block.kind === 'bullets') claims.push(...(block.items ?? []));
      else if (block.claim) claims.push(block.claim);
    }
  };
  collectBlocks(doc.preamble);
  for (const section of doc.sections) collectBlocks(section.blocks);
  return claims;
}

/**
 * @typedef {object} AttributedMetric
 * @property {string} metric  - Normalized metric claim text (see normalizeClaim).
 * @property {import('./model.mjs').SourceSpan} source - Where in the CV this metric was found.
 */

/**
 * Walk every claim in a CvDocument and extract the metric assertions each one
 * makes, each tagged with the SourceSpan of the claim it came from.
 *
 * @param {import('./model.mjs').CvDocument} doc
 * @returns {AttributedMetric[]}
 */
export function extractDocumentMetrics(doc) {
  /** @type {AttributedMetric[]} */
  const out = [];
  for (const claim of allTextClaims(doc)) {
    for (const metric of metricClaims(claim.text)) {
      out.push({ metric, source: claim.source });
    }
  }
  return out;
}

/**
 * @typedef {object} AttributedFact
 * @property {'employer'|'title'|'tool'} kind
 * @property {string} value
 * @property {import('./model.mjs').SourceSpan} source
 */

/**
 * Walk every claim in a CvDocument and extract the employer/title/tool facts
 * each one asserts, each tagged with the SourceSpan of the claim it came from.
 *
 * @param {import('./model.mjs').CvDocument} doc
 * @returns {AttributedFact[]}
 */
export function extractDocumentFacts(doc) {
  /** @type {AttributedFact[]} */
  const out = [];
  for (const claim of allTextClaims(doc)) {
    for (const fact of factClaims(claim.text)) {
      out.push({ ...fact, source: claim.source });
    }
  }
  return out;
}

/**
 * @typedef {object} ProvenanceResult
 * @property {{ metric: string, source: import('./model.mjs').SourceSpan }[]} backed
 *   - Metric claims in candidateText that ARE present somewhere in the CV,
 *     paired with (one of) the source span(s) that backs them.
 * @property {string[]} unbacked
 *   - Metric claims in candidateText with NO matching claim anywhere in the CV.
 *     A non-empty list here is the §4.3 defense firing: this text asserts
 *     something the CV's own author never wrote.
 */

/**
 * Check whether every metric claim in a piece of candidate text (e.g. an
 * LLM-tailored bullet) is backed by something the CV's own author wrote.
 *
 * This is deliberately narrow — it answers "is this specific number/percentage/
 * multiplier traceable", not "is this sentence true". A candidate string with
 * no metric claims at all returns `{ backed: [], unbacked: [] }`, which is a
 * pass: prose with no quantified assertion has nothing here to verify.
 *
 * @param {string} candidateText
 * @param {import('./model.mjs').CvDocument} doc
 * @returns {import('../shared/result.mjs').Result<ProvenanceResult, never>}
 */
export function checkProvenance(candidateText, doc) {
  const sourceMetrics = extractDocumentMetrics(doc);
  const sourceByMetric = new Map();
  for (const { metric, source } of sourceMetrics) {
    if (!sourceByMetric.has(metric)) sourceByMetric.set(metric, source);
  }

  /** @type {ProvenanceResult['backed']} */
  const backed = [];
  /** @type {string[]} */
  const unbacked = [];
  for (const metric of metricClaims(candidateText)) {
    const source = sourceByMetric.get(metric);
    if (source) backed.push({ metric, source });
    else unbacked.push(metric);
  }

  return ok({ backed, unbacked });
}
