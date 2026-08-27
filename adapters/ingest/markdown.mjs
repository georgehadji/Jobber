// @ts-check
// adapters/ingest/markdown.mjs — validate and parse a markdown/plaintext CV
// upload into a scored CvDocument, deterministically and at zero LLM cost.
//
// The gap this closes: web/src/app/api/cv/ingest/route.ts today sends EVERY
// upload — including an already-well-formed cv.md — through an LLM
// transcription round trip (FILE_SRC: "READ it with your file/Read tool, then
// convert it"). There is no fast path for the single most common and lowest-
// risk case: text that is already markdown. That costs latency, spend, and a
// (small but nonzero) hallucination-risk re-derivation of content that did not
// need re-deriving. This adapter is that fast path: given raw text, produce
// either a validated CvDocument plus its CvScore, or a specific, actionable
// parse error — no model call, no re-derivation, sub-millisecond.
//
// Deliberately NOT wired into web/'s route in this change — that route's own
// design (a PROPOSER that always defers to the LLM) may be intentional for
// reasons this session does not have full context on, and changing live
// application behavior is a different, larger decision than adding the
// underlying capability. This ships the adapter, tested and ready; wiring it
// in as web/'s fast path for .md/.txt/pasted-text uploads is a follow-up.
//
// Per POLYTONIC-PLAN.md §2.2, ingestion adapters live under adapters/ingest/
// even where — as here — the specific function ends up pure, because this is
// the designated boundary where untrusted external input (TB1, §4.2) enters
// the system, and a caller looks for that boundary by location, not by
// checking whether today's implementation happens to touch a filesystem.
//
// Takes a STRING, not a Buffer/File: decoding raw upload bytes to UTF-8 is the
// caller's job (an HTTP route, a CLI reading a file). This adapter's job starts
// once you have text.

import { err, domainError, map } from '../../core/shared/result.mjs';
import { parseCvMarkdown } from '../../core/cv/parse.mjs';
import { scoreCv } from '../../core/cv/score/index.mjs';

// Generous headroom over any realistic CV (a very long one, hand-written, runs
// 20-50 KB) while still bounding parse cost against something absurd landing
// in an upload body. Not the same cap as PDF ingestion (§4.2's 10 MB, which
// bounds a compressed binary format before any text is even extracted) —
// markdown IS the text, so its cap is much smaller.
export const MAX_MARKDOWN_BYTES = 256 * 1024;

const BOM = String.fromCharCode(0xfeff);
// Built via fromCharCode, not a literal escape in source, so no control
// character ever has to survive a copy/paste or a tool round-trip intact.
const NULL_BYTE = String.fromCharCode(0);

/**
 * @typedef {object} IngestedCv
 * @property {import('../../core/cv/model.mjs').CvDocument} doc
 * @property {import('../../core/cv/score/rubric.mjs').CvScore} score
 */

/**
 * Validate and parse raw markdown/plaintext into an IngestedCv.
 *
 * @param {string} text
 * @returns {import('../../core/shared/result.mjs').Result<IngestedCv, import('../../core/shared/result.mjs').DomainError>}
 */
export function ingestMarkdown(text) {
  if (typeof text !== 'string') {
    return err(domainError('INGEST_NOT_A_STRING', 'ingestMarkdown expects a string'));
  }

  // Byte length, not character length — a CV full of non-Latin script (CJK,
  // Cyrillic, emoji in a portfolio bullet) has far more bytes per character
  // than an ASCII one, and the cap exists to bound actual memory/parse cost.
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > MAX_MARKDOWN_BYTES) {
    return err(domainError(
      'INGEST_TOO_LARGE',
      `input is ${byteLength} bytes, over the ${MAX_MARKDOWN_BYTES}-byte limit for a markdown CV`,
      { byteLength, maxBytes: MAX_MARKDOWN_BYTES },
    ));
  }

  // A null byte is never legitimate CV content and is a classic signal of a
  // truncated/binary upload masquerading as text (e.g. a .docx renamed to
  // .md, or a partial multipart read) — reject outright rather than let it
  // silently corrupt downstream string handling.
  if (text.includes(NULL_BYTE)) {
    return err(domainError('INGEST_NULL_BYTE', 'input contains a null byte — not valid text content'));
  }

  // Strip a leading UTF-8 BOM. Extremely common from Windows Notepad and some
  // "save as plain text" flows in word processors, and fatal without this:
  // parseCvMarkdown requires the FIRST line to start with "# ", and a BOM
  // sitting before the "#" makes that requirement fail with a confusing
  // CV_MISSING_TITLE error that never mentions the real cause. Confirmed as a
  // real, reproducible failure while building this, not a hypothetical.
  const withoutBom = text.startsWith(BOM) ? text.slice(BOM.length) : text;

  const parsed = parseCvMarkdown(withoutBom);
  if (!parsed.ok) return parsed;

  return map(parsed, (doc) => ({ doc, score: scoreCv(doc) }));
}
