// tests/core-cv-render.test.mjs — core/cv/render.mjs (W1: CvDocument to markdown)
//
// Round-trip properties (parse -> render -> parse) live in
// tests/core-cv-roundtrip.test.mjs. This file tests render.mjs in isolation:
// given a hand-built CvDocument, does it produce the markdown the shape implies.
import { pass, fail } from './helpers.mjs';
import { renderCvMarkdown } from '../core/cv/render.mjs';

console.log('\ncore/cv/render.mjs — CvDocument to markdown (W1)');

/** @param {string} text @param {import('../core/cv/model.mjs').ClaimKind} kind */
function claim(text, kind = 'paragraph') {
  return { text, kind, source: { start: 0, end: text.length, line: 1, text, contentHash: '00000000' } };
}

try {
  // 1. Minimal document: title + one section + one paragraph.
  const minimal = renderCvMarkdown({
    title: claim('Jane Doe', 'heading'),
    preamble: [],
    sections: [{ key: 'summary', heading: claim('Summary', 'heading'), blocks: [{ kind: 'paragraph', claim: claim('Does things.') }] }],
    sourceHash: 'x',
  });
  if (minimal === '# Jane Doe\n\n## Summary\n\nDoes things.\n') pass('renders a minimal title+section+paragraph document');
  else fail(`minimal render: ${JSON.stringify(minimal)}`);

  // 2. Bullets render one "- " line per item, joined without blank lines between
  //    items (only between blocks, not within one bullets block).
  const bulleted = renderCvMarkdown({
    title: claim('Jane Doe', 'heading'),
    preamble: [],
    sections: [{ key: 'skills', heading: claim('Skills', 'heading'), blocks: [{ kind: 'bullets', items: [claim('Python'), claim('Go')] }] }],
    sourceHash: 'x',
  });
  if (bulleted === '# Jane Doe\n\n## Skills\n\n- Python\n- Go\n') pass('renders bullet items on consecutive lines within one block');
  else fail(`bulleted render: ${JSON.stringify(bulleted)}`);

  // 3. A heading block's `level` controls how many # characters come back,
  //    not a hardcoded 3 — depth is round-trippable for any level 3-6.
  for (const level of [3, 4, 5, 6]) {
    const rendered = renderCvMarkdown({
      title: claim('T', 'heading'),
      preamble: [],
      sections: [{ key: 's', heading: claim('S', 'heading'), blocks: [{ kind: 'heading', level, claim: claim('Sub') }] }],
      sourceHash: 'x',
    });
    const expectedMarker = '#'.repeat(level);
    if (rendered.includes(`\n${expectedMarker} Sub\n`)) {
      pass(`heading level ${level} renders with ${level} '#' characters`);
    } else {
      fail(`level ${level}: ${JSON.stringify(rendered)}`);
    }
  }

  // 4. An empty preamble contributes nothing — no stray blank block between the
  //    title and the first section.
  const noPreamble = renderCvMarkdown({
    title: claim('T', 'heading'),
    preamble: [],
    sections: [{ key: 's', heading: claim('S', 'heading'), blocks: [{ kind: 'paragraph', claim: claim('x') }] }],
    sourceHash: 'x',
  });
  if (noPreamble === '# T\n\n## S\n\nx\n') pass('an empty preamble adds no extra blank block');
  else fail(`empty-preamble render: ${JSON.stringify(noPreamble)}`);

  // 5. A non-empty preamble renders between the title and the first section.
  const withPreamble = renderCvMarkdown({
    title: claim('T', 'heading'),
    preamble: [{ kind: 'paragraph', claim: claim('contact info here') }],
    sections: [{ key: 's', heading: claim('S', 'heading'), blocks: [{ kind: 'paragraph', claim: claim('x') }] }],
    sourceHash: 'x',
  });
  if (withPreamble === '# T\n\ncontact info here\n\n## S\n\nx\n') pass('preamble content renders between the title and the first section');
  else fail(`preamble render: ${JSON.stringify(withPreamble)}`);

  // 6. A document with no sections still renders (title-only) — render.mjs does
  //    not enforce parse.mjs's "must have at least one section" rule; that
  //    validation belongs to the parser, not the renderer, and a hand-built
  //    in-memory document is allowed to be in a state parse.mjs would reject.
  const titleOnly = renderCvMarkdown({ title: claim('Solo', 'heading'), preamble: [], sections: [], sourceHash: 'x' });
  if (titleOnly === '# Solo\n') pass('a document with no sections still renders (renderer does not re-enforce parser invariants)');
  else fail(`title-only render: ${JSON.stringify(titleOnly)}`);

  // 7. Output always ends with exactly one trailing newline, regardless of shape.
  const trailingChecks = [minimal, bulleted, noPreamble, withPreamble, titleOnly];
  if (trailingChecks.every((s) => s.endsWith('\n') && !s.endsWith('\n\n'))) {
    pass('every rendered document ends with exactly one trailing newline');
  } else {
    fail('inconsistent trailing newline behavior');
  }
} catch (e) {
  fail(`core-cv-render tests crashed: ${e.message}\n${e.stack}`);
}
