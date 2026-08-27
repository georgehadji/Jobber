// @ts-check
// core/cv/render.mjs — CvDocument -> markdown, the inverse of parse.mjs.
//
// This is deliberately the exact inverse of the grammar parse.mjs accepts, not
// a general-purpose markdown formatter: given a document parse.mjs produced,
// re-rendering and re-parsing must land on the same document. That is the
// round-trip property tested in tests/core-cv-render.test.mjs and is what makes
// a CvDocument a genuine intermediate representation rather than a lossy copy.
//
// One asymmetry is intentional, not a bug: parse.mjs normalizes a claim's text
// (normalizeWhitespace — internal whitespace collapsed, including soft line
// breaks within a markdown paragraph), while SourceSpan.text keeps the original
// bytes for provenance. render.mjs works from claim.text, the semantic content —
// so re-rendering a paragraph whose source spanned five soft-wrapped lines
// produces ONE line. Re-parsing that output reproduces the same CvDocument
// (same claim text, same structure); it does not reproduce the original
// byte-for-byte line wrapping, because that wrapping was never semantic in the
// first place. A CV written in the single-block-per-line style parse.mjs's own
// module comment shows as canonical (see test-fixtures/upgrade/state-v1.18/cv.md)
// round-trips byte-for-byte, and is asserted as such.
//
// Pure module: no side effects, no process.exit, no I/O at import.

/**
 * Render one content block. A heading block's own `level` (3-6, set by parse.mjs
 * from how many `#` characters were in the source) drives how many `#`
 * characters come back out, so depth is preserved rather than assumed.
 *
 * @param {import('./model.mjs').Block} block
 * @returns {string}
 */
function renderBlock(block) {
  if (block.kind === 'heading') {
    // Invariant from parse.mjs: a 'heading' block always carries `claim`; only
    // 'bullets' blocks omit it. Block's typedef marks `claim` optional across
    // all three kinds rather than a discriminated union per kind, so this is
    // asserted here rather than narrowed by the type checker.
    const claim = /** @type {import('./model.mjs').Claim} */ (block.claim);
    return `${'#'.repeat(block.level ?? 3)} ${claim.text}`;
  }
  if (block.kind === 'paragraph') {
    const claim = /** @type {import('./model.mjs').Claim} */ (block.claim);
    return claim.text;
  }
  // bullets
  return (block.items ?? []).map((item) => `- ${item.text}`).join('\n');
}

/**
 * Render a CvDocument back to markdown.
 *
 * @param {import('./model.mjs').CvDocument} doc
 * @returns {string}
 */
export function renderCvMarkdown(doc) {
  /** @type {string[]} */
  const parts = [`# ${doc.title.text}`];

  for (const block of doc.preamble) {
    parts.push(renderBlock(block));
  }

  for (const section of doc.sections) {
    parts.push(`## ${section.heading.text}`);
    for (const block of section.blocks) {
      parts.push(renderBlock(block));
    }
  }

  return parts.join('\n\n') + '\n';
}
