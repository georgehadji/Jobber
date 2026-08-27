// @ts-check
// core/cv/parse.mjs — markdown -> Result<CvDocument>.
//
// This is the function whose absence generate-pdf.mjs's own usage error names
// as a deliberate gap: "there is no mechanical markdown-to-HTML step by
// design." That gap is what forces every render to re-derive structure from
// prose via an LLM. This is the mechanical step.
//
// Grammar supported (deliberately small; extend only against a real cv.md that
// does not parse, per §3.8 — parse, don't validate against imagined cases):
//
//   # title line                     -> CvDocument.title (verbatim, no schema guessed)
//   ## Section Heading                -> a Section (key resolved via sectionKey())
//   ###+ Sub-heading                  -> a 'heading' Block inside the current section
//   - bullet text                     -> part of a 'bullets' Block (consecutive items merge)
//   any other non-blank line(s)       -> a 'paragraph' Block (consecutive lines merge)
//   blank lines                       -> block/section separators, otherwise insignificant
//
// Byte offsets and line numbers in every SourceSpan point at the ORIGINAL input
// text (line endings normalized to \n first, offsets computed against that
// normalized string — callers that need to map back to a CRLF file re-run the
// same normalization, which is deterministic and lossless for this purpose).
//
// Pure module: no side effects, no process.exit, no I/O at import.

import { ok, err, domainError } from '../shared/result.mjs';
import { fingerprint, normalizeWhitespace } from '../shared/text.mjs';
import { sectionKey } from './model.mjs';

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;

/**
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {number} line
 * @param {import('./model.mjs').ClaimKind} kind
 * @returns {import('./model.mjs').Claim}
 */
function makeClaim(text, start, end, line, kind) {
  const raw = text.slice(start, end);
  return {
    text: normalizeWhitespace(raw),
    kind,
    source: { start, end, line, text: raw, contentHash: fingerprint(normalizeWhitespace(raw)) },
  };
}

/**
 * Parse markdown into a CvDocument.
 *
 * @param {string} markdown
 * @returns {import('../shared/result.mjs').Result<import('./model.mjs').CvDocument, import('../shared/result.mjs').DomainError>}
 */
export function parseCvMarkdown(markdown) {
  if (typeof markdown !== 'string') {
    return err(domainError('CV_PARSE_NOT_A_STRING', 'parseCvMarkdown expects a string'));
  }

  // Normalize line endings only — nothing else about the input is altered before
  // offsets are computed, so SourceSpan.text is exactly what the author wrote.
  const source = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (source.trim() === '') {
    return err(domainError('CV_EMPTY', 'the document is empty'));
  }

  // Precompute the char offset each line starts at, so a line index converts to
  // an offset in O(1) instead of re-scanning.
  const lines = source.split('\n');
  /** @type {number[]} */
  const lineStarts = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    lineStarts.push(lineStarts[i] + lines[i].length + 1); // +1 for the \n
  }

  let i = 0;

  // Skip leading blank lines, then require a `# ` title as the first content.
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) {
    return err(domainError('CV_EMPTY', 'the document has no content'));
  }
  const titleMatch = HEADING_RE.exec(lines[i]);
  if (!titleMatch || titleMatch[1].length !== 1) {
    return err(domainError(
      'CV_MISSING_TITLE',
      'the document must start with a level-1 heading (# Name — Title)',
      { line: i + 1, text: lines[i] },
    ));
  }
  const titleContentStart = lineStarts[i] + (lines[i].length - titleMatch[2].length);
  const title = makeClaim(source, titleContentStart, lineStarts[i] + lines[i].length, i + 1, 'heading');
  i++;

  /** @type {import('./model.mjs').Section[]} */
  const sections = [];
  /** @type {import('./model.mjs').Section | null} */
  let currentSection = null;
  // Starts as the PREAMBLE accumulator (content between the title and the first
  // `## ` section — see examples/cv-example.md's contact block) and is reassigned
  // to a fresh array each time a `## ` section opens. Never null: unlike sections,
  // a document with no preamble just has an empty one, not a missing one.
  /** @type {import('./model.mjs').Block[]} */
  let currentBlocks = [];
  /** @type {import('./model.mjs').Block[]} */
  let preamble = [];

  // Accumulator for the block currently being built, so consecutive
  // paragraph lines / bullet items merge into ONE block instead of one per line.
  /** @type {{ kind: 'paragraph', startLine: number } | { kind: 'bullets', items: import('./model.mjs').Claim[] } | null} */
  let pending = null;

  function flushPending() {
    if (!pending) return;
    if (pending.kind === 'bullets') {
      if (pending.items.length > 0) currentBlocks.push({ kind: 'bullets', items: pending.items });
    }
    // 'paragraph' pending is flushed at the call site (needs the end line), see below.
    pending = null;
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      // Blank line: ends whatever paragraph is being accumulated (bullets end
      // naturally at the next non-bullet line, handled below).
      if (pending && pending.kind === 'paragraph') {
        const endLine = i; // exclusive: paragraph ran through line i-1
        const start = lineStarts[pending.startLine];
        const end = lineStarts[endLine - 1] + lines[endLine - 1].length;
        currentBlocks.push({ kind: 'paragraph', claim: makeClaim(source, start, end, pending.startLine + 1, 'paragraph') });
        pending = null;
      }
      i++;
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;

      // Flush whatever was pending before starting a new heading.
      if (pending && pending.kind === 'paragraph') {
        const endLine = i;
        const start = lineStarts[pending.startLine];
        const end = lineStarts[endLine - 1] + lines[endLine - 1].length;
        currentBlocks.push({ kind: 'paragraph', claim: makeClaim(source, start, end, pending.startLine + 1, 'paragraph') });
      }
      flushPending();

      if (level === 1) {
        return err(domainError(
          'CV_MULTIPLE_TITLES',
          'a second level-1 heading was found — a CV has exactly one title',
          { line: i + 1, text: line },
        ));
      }

      if (level === 2) {
        // Close whatever was open — the previous section, or (on the FIRST ##
        // heading) the preamble accumulated before any section existed.
        if (currentSection) {
          currentSection.blocks = currentBlocks;
          sections.push(currentSection);
        } else {
          preamble = currentBlocks;
        }
        const contentStart = lineStarts[i] + (line.length - headingMatch[2].length);
        const headingClaim = makeClaim(source, contentStart, lineStarts[i] + line.length, i + 1, 'heading');
        currentSection = { key: sectionKey(headingClaim.text), heading: headingClaim, blocks: [] };
        currentBlocks = [];
      } else {
        // level 3-6: a sub-heading block inside the current section. Unlike plain
        // text or bullets, this has nowhere sensible to go before any ## section
        // exists — "a sub-heading of the preamble" is not a real structure — so
        // it stays a hard error rather than folding into currentBlocks.
        if (!currentSection) {
          return err(domainError(
            'CV_HEADING_BEFORE_SECTION',
            'found a sub-heading before any ## section heading',
            { line: i + 1, text: line },
          ));
        }
        const contentStart = lineStarts[i] + (line.length - headingMatch[2].length);
        currentBlocks.push({ kind: 'heading', level, claim: makeClaim(source, contentStart, lineStarts[i] + line.length, i + 1, 'heading') });
      }
      i++;
      continue;
    }

    const bulletMatch = BULLET_RE.exec(line);
    if (bulletMatch) {
      if (pending && pending.kind === 'paragraph') {
        // A paragraph directly followed by a bullet: close the paragraph first.
        const endLine = i;
        const start = lineStarts[pending.startLine];
        const end = lineStarts[endLine - 1] + lines[endLine - 1].length;
        currentBlocks.push({ kind: 'paragraph', claim: makeClaim(source, start, end, pending.startLine + 1, 'paragraph') });
        pending = null;
      }
      if (!pending || pending.kind !== 'bullets') {
        pending = { kind: 'bullets', items: [] };
      }
      // Bullet text starts right after "- " (or "* "): recompute the exact offset
      // from a marker-only match rather than trusting BULLET_RE's capture group
      // index, since that regex's whole match already discards leading whitespace.
      const marker = line.match(/^\s*[-*]\s+/);
      const textStart = lineStarts[i] + (marker ? marker[0].length : 0);
      const textEnd = lineStarts[i] + line.length;
      pending.items.push(makeClaim(source, textStart, textEnd, i + 1, 'bullet'));
      i++;
      continue;
    }

    // Plain text line: part of a paragraph (preamble, if no section has opened yet).
    if (pending && pending.kind === 'bullets') {
      flushPending();
    }
    if (!pending) {
      pending = { kind: 'paragraph', startLine: i };
    }
    i++;
  }

  // Flush whatever is pending at end of document.
  if (pending) {
    if (pending.kind === 'paragraph') {
      const start = lineStarts[pending.startLine];
      const end = lineStarts[lines.length - 1] + lines[lines.length - 1].length;
      currentBlocks.push({ kind: 'paragraph', claim: makeClaim(source, start, end, pending.startLine + 1, 'paragraph') });
    } else if (pending.kind === 'bullets' && pending.items.length > 0) {
      currentBlocks.push({ kind: 'bullets', items: pending.items });
    }
  }
  if (currentSection) {
    currentSection.blocks = currentBlocks;
    sections.push(currentSection);
  }

  if (sections.length === 0) {
    return err(domainError('CV_NO_SECTIONS', 'the document has a title but no ## sections'));
  }

  return ok({ title, preamble, sections, sourceHash: fingerprint(source) });
}
