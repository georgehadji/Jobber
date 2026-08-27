// @ts-check
// core/cv/model.mjs — the canonical CV document model.
//
// This is the piece POLYTONIC-PLAN.md §W1 names as unblocking everything else:
// today no code parses cv.md into structured data (generate-pdf.mjs says so in
// its own usage error — "there is no mechanical markdown-to-HTML step by
// design"), so every render re-derives sections from prose via an LLM. This
// model is what a deterministic parse produces.
//
// Design: a FLAT BLOCK LIST per section, not a rigid Entry{org,dates,bullets}
// schema. Real cv.md files vary more than a fixed schema survives —
// test-fixtures/upgrade/state-v1.18/cv.md puts role/company/dates in one H3
// line, examples/cv-example.md splits company+location (H3), role (bold line),
// and dates (plain line) across three separate lines. A block list mirrors
// markdown structure 1:1 and lets a consumer (core/cv/render.mjs, a future
// entry-grouping helper) interpret it, rather than forcing every CV shape
// through one guessed schema at parse time and losing information the first
// time a real CV doesn't match it.
//
// Every leaf of user-authored text is a Claim carrying a SourceSpan — this is
// what makes provenance receipts (POLYTONIC-PLAN §W8.1) and the
// prompt-injection defense (§4.3: a generated claim with no source span is
// dropped) possible. It is deliberately NOT optional or added later.
//
// Pure module: no side effects, no process.exit, no I/O at import. All values
// described here are treated as immutable by convention — parse.mjs freezes
// what it builds; nothing in core/ mutates a CvDocument in place.

import { foldDiacritics } from '../shared/text.mjs';

/**
 * @typedef {object} SourceSpan
 * @property {number} start        - Character offset into the source markdown.
 * @property {number} end          - Exclusive end offset.
 * @property {number} line         - 1-indexed line the span starts on.
 * @property {string} text         - Verbatim source slice, exactly as written.
 * @property {string} contentHash  - fingerprint() of the normalized text (see core/shared/text.mjs).
 */

/**
 * @typedef {'heading'|'paragraph'|'bullet'} ClaimKind
 */

/**
 * A unit of user-authored text, traceable to exactly where it came from.
 *
 * @typedef {object} Claim
 * @property {string} text     - Normalized (whitespace-collapsed, trimmed) claim text.
 * @property {ClaimKind} kind
 * @property {SourceSpan} source
 */

/**
 * @typedef {'heading'|'paragraph'|'bullets'} BlockKind
 */

/**
 * One markdown block inside a section, in source order.
 *
 * - `heading`  — a sub-heading (### or deeper) inside the section; `level` is
 *                the heading depth (3-6), `claim` is the heading text.
 * - `paragraph`— a run of consecutive non-blank, non-heading, non-bullet lines,
 *                merged into one claim (a markdown paragraph).
 * - `bullets`  — a run of consecutive `- ` list items; each item is its own Claim.
 *
 * @typedef {object} Block
 * @property {BlockKind} kind
 * @property {number} [level]      - heading only
 * @property {Claim} [claim]       - heading | paragraph
 * @property {Claim[]} [items]     - bullets only
 */

/**
 * One `## `-level section of the CV.
 *
 * @typedef {object} Section
 * @property {string} key      - Canonical section key via sectionKey() (e.g. 'experience').
 * @property {Claim} heading   - The heading text itself, as written — also a Claim, so it
 *                                is traceable and diffable like everything else.
 * @property {Block[]} blocks  - Content nested under this heading, up to (not including)
 *                                the next `## ` heading or end of document.
 */

/**
 * The canonical parsed representation of a CV.
 *
 * @typedef {object} CvDocument
 * @property {Claim} title       - The `# ` line's content, as written (name, title — whatever
 *                                  the author put there; parse.mjs does not guess a schema
 *                                  for it, callers that want a display name read title.text
 *                                  themselves).
 * @property {Block[]} preamble  - Content between the title and the first `## ` section.
 *                                  Real CVs commonly put a contact block here (see
 *                                  examples/cv-example.md: `**Location:** ...` lines directly
 *                                  under the `# ` title). Empty array when there is none.
 * @property {Section[]} sections
 * @property {string} sourceHash - fingerprint() of the ENTIRE original source text, used by
 *                                  round-trip tests and reuse caching (POLYTONIC-PLAN §W5.4)
 *                                  to detect "has this CV changed at all" cheaply.
 */

/**
 * Heading spelling → canonical section key.
 *
 * Ported from generate-pdf.mjs's SECTION_ALIASES (the table that already
 * governs rendered section ORDER). This copy governs what a parsed section is
 * CALLED. Keeping them as separate, independently-edited tables would let the
 * parser and the renderer drift on what counts as "the same section" — so this
 * one is treated as the source of truth and generate-pdf.mjs's copy is the one
 * to fold into it in a later pass (tracked, not done silently here: changing
 * generate-pdf.mjs's behavior is out of scope for adding a new parser).
 *
 * @type {Map<string, string>}
 */
export const SECTION_ALIASES = new Map(
  /** @type {[string, string][]} */ ([
    // English — cv.md is the source of truth and is written in English.
    ['summary', 'summary'],
    ['professional summary', 'summary'],
    ['competencies', 'competencies'],
    ['core competencies', 'competencies'],
    ['experience', 'experience'],
    ['work experience', 'experience'],
    ['professional experience', 'experience'],
    ['projects', 'projects'],
    ['selected projects', 'projects'],
    ['personal projects', 'projects'],
    ['education', 'education'],
    ['education & certifications', 'education'],
    ['certifications', 'certifications'],
    ['skills', 'skills'],
    ['technical skills', 'skills'],
    // Polish — the vocabulary documented in modes/pl/README.md, plus the
    // word-order variants that turn up in practice.
    ['podsumowanie', 'summary'],
    ['podsumowanie zawodowe', 'summary'],
    ['profil zawodowy', 'summary'],
    ['kompetencje', 'competencies'],
    ['kompetencje kluczowe', 'competencies'],
    ['kluczowe kompetencje', 'competencies'],
    ['doswiadczenie', 'experience'],
    ['doswiadczenie zawodowe', 'experience'],
    ['przebieg kariery', 'experience'],
    ['projekty', 'projects'],
    ['kluczowe projekty', 'projects'],
    ['wybrane projekty', 'projects'],
    ['wyksztalcenie', 'education'],
    ['edukacja', 'education'],
    ['wyksztalcenie i certyfikaty', 'education'],
    ['certyfikaty', 'certifications'],
    ['certyfikaty i szkolenia', 'certifications'],
    ['szkolenia i certyfikaty', 'certifications'],
    ['umiejetnosci', 'skills'],
    ['umiejetnosci techniczne', 'skills'],
  ].map(([alias, key]) => /** @type {[string, string]} */ ([foldDiacritics(alias), key]))
));

/**
 * Strip inline markdown emphasis/code markers and collapse whitespace, the
 * same normalization generate-pdf.mjs applies before matching a heading
 * against SECTION_ALIASES.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeSectionTitle(text) {
  return text
    .replace(/\{\{[^}]+\}\}/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a `## ` heading's text to a canonical section key. Unrecognized
 * headings fall back to their own folded, lowercased text — so a CV with an
 * unusual section still parses (as an unknown-but-stable key) rather than
 * failing closed. §3.8 (parse, don't validate) governs elsewhere; here the
 * bar for the whole document to parse is deliberately low, and rubric code
 * downstream (W3) decides what to do with a key it doesn't recognize.
 *
 * @param {string} text
 * @returns {string}
 */
export function sectionKey(text) {
  const normalized = foldDiacritics(normalizeSectionTitle(text)).toLowerCase();
  return SECTION_ALIASES.get(normalized) ?? normalized;
}
