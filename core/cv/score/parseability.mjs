// @ts-check
// core/cv/score/parseability.mjs — structural ATS-parse risk.
//
// Scores signals available from the PARSED CvDocument alone: whether section
// headings resolved to a recognized key (modes/pdf.md's own "ATS Rules"
// section names standard headers as a real requirement — "Standard headers:
// Professional Summary, Work Experience, Education, Skills, Certifications,
// Projects" — an ATS that keys off known section labels may misfile or skip
// a heading it does not recognize), whether any section is a heading with no
// content, and whether any single bullet is long enough to be a real risk of
// wrapping into a dense, skim-resistant block.
//
// What this deliberately does NOT measure: whether a RENDERED PDF actually
// extracts cleanly. That is a claim about bytes on a page, not about parsed
// markdown structure, and can only be answered by generating the PDF and
// reading the text back out of it — the round-trip verification named in
// POLYTONIC-PLAN.md §W3.2, which needs a real renderer (an adapter, not core/)
// and is deferred to that work. Presenting a structural proxy as if it were
// that measurement would be exactly the "score sold as science" problem the
// plan's own competitive research flags across this product category — see
// rubric.mjs's header comment. This dimension's findings are phrased as
// structural risk, not as an extraction guarantee.
//
// Pure module: no side effects, no process.exit, no I/O at import.

import { sectionKey } from '../model.mjs';

// A section key literally equal to its own folded heading text (sectionKey's
// documented fallback for an unrecognized heading, per model.mjs) means it
// never matched SECTION_ALIASES. Recomputing sectionKey on the section's own
// (already-resolved) key is how "was this recognized" is checked without
// threading a second boolean through parse.mjs's Section shape.
const KNOWN_SECTION_KEYS = new Set(['summary', 'competencies', 'experience', 'projects', 'education', 'certifications', 'skills']);

// A generous, explicitly-labeled heuristic: roughly double a comfortable
// single-line bullet at typical CV body-text sizes (cv-template.html renders
// body copy at 11px). This flags only genuinely oversized bullets, not normal
// ones — it is a proxy for "likely renders as 3+ lines", not a page measurement.
const LONG_BULLET_CHARS = 220;

/**
 * @param {import('../model.mjs').CvDocument} doc
 * @returns {import('./rubric.mjs').DimensionScore}
 */
export function scoreParseability(doc) {
  /** @type {string[]} */
  const findings = [];
  /** @type {import('../model.mjs').SourceSpan[]} */
  const evidence = [];
  /** @type {number[]} */
  const penalties = [];

  // 1. Unrecognized section headings.
  const unrecognized = doc.sections.filter((s) => !KNOWN_SECTION_KEYS.has(s.key));
  if (unrecognized.length > 0) {
    const penalty = Math.min(0.5, unrecognized.length * 0.15);
    penalties.push(penalty);
    findings.push(`${unrecognized.length} section heading(s) not among the standard set an ATS keys off of: ${unrecognized.map((s) => `"${s.heading.text}"`).join(', ')}.`);
    evidence.push(...unrecognized.map((s) => s.heading.source));
  } else {
    findings.push('All section headings use recognized, standard labels.');
  }

  // 2. Empty sections — a heading with no content is a structural defect an
  //    ATS (and a recruiter) will see as a broken section.
  const empty = doc.sections.filter((s) => s.blocks.length === 0);
  if (empty.length > 0) {
    penalties.push(Math.min(0.3, empty.length * 0.15));
    findings.push(`${empty.length} section(s) have a heading but no content: ${empty.map((s) => `"${s.heading.text}"`).join(', ')}.`);
    evidence.push(...empty.map((s) => s.heading.source));
  }

  // 3. Presence of a recognizable experience or summary section — a CV an ATS
  //    cannot locate any work history in is a severe structural risk.
  const hasCore = doc.sections.some((s) => s.key === 'experience' || s.key === 'summary');
  if (!hasCore) {
    penalties.push(0.4);
    findings.push('No "Summary" or "Experience" section found — an ATS may have nothing to index as work history.');
  }

  // 4. Oversized bullets.
  /** @type {import('../model.mjs').Claim[]} */
  const longBullets = [];
  for (const section of doc.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'bullets') continue;
      for (const item of block.items ?? []) {
        if (item.text.length > LONG_BULLET_CHARS) longBullets.push(item);
      }
    }
  }
  if (longBullets.length > 0) {
    penalties.push(Math.min(0.2, longBullets.length * 0.05));
    findings.push(`${longBullets.length} bullet(s) exceed ${LONG_BULLET_CHARS} characters and likely wrap into a dense block.`);
    evidence.push(...longBullets.map((b) => b.source));
  }

  const totalPenalty = Math.min(1, penalties.reduce((a, b) => a + b, 0));
  const score = 1 - totalPenalty;

  return { key: 'parseability', score, findings, evidence };
}
