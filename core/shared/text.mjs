// @ts-check
// core/shared/text.mjs — text normalization and a non-cryptographic content
// fingerprint, shared across the domain core.
//
// Why not node:crypto: core/ imports nothing outside core/ (validate-core-purity.mjs
// enforces this). A cryptographic hash is also the wrong tool here — this fingerprint
// exists to answer "did this claim's source text change since we last saw it?", the
// same job fingerprint-core.mjs's SimHash already does for cross-listing dedup in the
// scanner. FNV-1a is the same choice for the same reason: fast, dependency-free,
// deterministic, and adequate for change-detection rather than tamper-proofing.
//
// Pure module: no side effects, no process.exit, no I/O at import.

/**
 * Fold combining diacritics and the Polish stroked-L (which NFD does not
 * decompose) so accented and unaccented spellings compare equal.
 *
 * Ported verbatim from generate-pdf.mjs's foldDiacritics — that copy stays where
 * it is (an adapter/renderer concern importing node built-ins elsewhere in the
 * file), this one is the pure-core copy core/cv/model.mjs builds on for section
 * heading matching.
 *
 * @param {string} text
 * @returns {string}
 */
export function foldDiacritics(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

/**
 * Collapse runs of whitespace to a single space and trim. The normalized form
 * two claims are compared by — "  runs   of\nwhitespace " and "runs of whitespace"
 * are the same claim, but the ORIGINAL text (with its real whitespace) is what
 * SourceSpan.text preserves, so provenance still points at exactly what the user
 * wrote.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * FNV-1a, 32-bit, returned as 8 lowercase hex characters.
 *
 * A collision here means two different claims are treated as one for
 * change-detection purposes — annoying (a stale provenance link), not a
 * security property. Nothing in this codebase treats contentHash as tamper-evident.
 *
 * @param {string} text
 * @returns {string}
 */
export function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Split text into 1-indexed lines the way SourceSpan line numbers are counted:
 * `\n` boundaries only, no special CRLF handling (parse.mjs normalizes line
 * endings before this is ever called).
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  return text.split('\n');
}
