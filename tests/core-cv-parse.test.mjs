// tests/core-cv-parse.test.mjs — core/cv/parse.mjs (W1: CV parsing)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pass, fail } from './helpers.mjs';
import { parseCvMarkdown } from '../core/cv/parse.mjs';

console.log('\ncore/cv/parse.mjs — markdown to CvDocument (W1)');

/** Every SourceSpan in a document must slice back to its own recorded text. */
function checkAllSpans(doc, normalizedSource) {
  const problems = [];
  const check = (claim, label) => {
    const slice = normalizedSource.slice(claim.source.start, claim.source.end);
    if (slice !== claim.source.text) problems.push(`${label}: slice ${JSON.stringify(slice)} != recorded ${JSON.stringify(claim.source.text)}`);
  };
  check(doc.title, 'title');
  for (const b of doc.preamble) {
    if (b.kind === 'bullets') b.items.forEach((it, i) => check(it, `preamble.bullets[${i}]`));
    else check(b.claim, `preamble.${b.kind}`);
  }
  for (const s of doc.sections) {
    check(s.heading, `section[${s.key}].heading`);
    for (const b of s.blocks) {
      if (b.kind === 'bullets') b.items.forEach((it, i) => check(it, `section[${s.key}].bullets[${i}]`));
      else check(b.claim, `section[${s.key}].${b.kind}`);
    }
  }
  return problems;
}

try {
  // 1. The canonical fixture parses with correct structure.
  const canonicalPath = fileURLToPath(new URL('../test-fixtures/upgrade/state-v1.18/cv.md', import.meta.url));
  const canonical = readFileSync(canonicalPath, 'utf8');
  const r1 = parseCvMarkdown(canonical);
  if (r1.ok) pass('parses the canonical fixture (test-fixtures/upgrade/state-v1.18/cv.md)');
  else fail(`canonical fixture failed to parse: ${JSON.stringify(r1.error)}`);

  if (r1.ok) {
    const doc = r1.value;
    if (doc.title.text === 'Jordan Reyes — Platform Engineer') pass('extracts the title correctly');
    else fail(`title: ${JSON.stringify(doc.title.text)}`);

    const keys = doc.sections.map((s) => s.key).join(',');
    if (keys === 'summary,experience,projects,education,skills') pass('resolves all five section keys via SECTION_ALIASES');
    else fail(`section keys: ${keys}`);

    const experience = doc.sections.find((s) => s.key === 'experience');
    const h3Count = experience.blocks.filter((b) => b.kind === 'heading' && b.level === 3).length;
    const bulletBlocks = experience.blocks.filter((b) => b.kind === 'bullets');
    if (h3Count === 2 && bulletBlocks.length === 2 && bulletBlocks[0].items.length === 3 && bulletBlocks[1].items.length === 2) {
      pass('experience section: 2 sub-headings, correct bullet counts per role (3 + 2)');
    } else {
      fail(`experience structure: h3=${h3Count}, bulletBlocks=${bulletBlocks.length}, counts=${bulletBlocks.map((b) => b.items.length)}`);
    }

    const problems = checkAllSpans(doc, canonical.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
    if (problems.length === 0) pass('every SourceSpan slices back to its own recorded text');
    else fail(`span mismatches: ${problems.join('; ')}`);
  }

  // 2. A CV with a preamble (contact block before the first ## section) parses,
  //    instead of erroring — this is real-world shape, not a hypothetical.
  const examplePath = fileURLToPath(new URL('../examples/cv-example.md', import.meta.url));
  const example = readFileSync(examplePath, 'utf8');
  const r2 = parseCvMarkdown(example);
  if (r2.ok) pass('parses a CV with a preamble contact block (examples/cv-example.md)');
  else fail(`preamble fixture failed to parse: ${JSON.stringify(r2.error)}`);

  if (r2.ok) {
    const doc = r2.value;
    if (doc.preamble.length === 1 && doc.preamble[0].kind === 'paragraph' && doc.preamble[0].claim.text.includes('alex@example.com')) {
      pass('preamble contact block captured as a paragraph block');
    } else {
      fail(`preamble: ${JSON.stringify(doc.preamble)}`);
    }
    const problems = checkAllSpans(doc, example.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
    if (problems.length === 0) pass('preamble fixture: every SourceSpan is correct too');
    else fail(`span mismatches: ${problems.join('; ')}`);

    // The H3 in this fixture is "Company -- Location" (no role/dates in the
    // heading — those are a separate bold line and plain line below it), which
    // is exactly the shape a rigid Entry{org,dates} schema would have broken on.
    const workExp = doc.sections.find((s) => s.key === 'experience');
    const firstH3 = workExp.blocks.find((b) => b.kind === 'heading');
    if (firstH3 && firstH3.claim.text === 'TechFin Corp -- Austin, TX') {
      pass('flat block model handles a CV shape a fixed Entry schema would not');
    } else {
      fail(`expected H3 "TechFin Corp -- Austin, TX", got ${JSON.stringify(firstH3?.claim?.text)}`);
    }
  }

  // 3. Bullet markers and heading markers are excluded from Claim.text (kept in
  //    SourceSpan.text raw, but the semantic text is content-only) — the bug
  //    this test guards was section keys resolving to "## summary" instead of
  //    "summary" because the whole line (with markers) was fed to sectionKey().
  const r3 = parseCvMarkdown('# Name\n\n## Summary\nSome text.\n');
  if (r3.ok && r3.value.sections[0].heading.text === 'Summary' && r3.value.sections[0].key === 'summary') {
    pass('heading Claim.text excludes the # markers (content only)');
  } else {
    fail(`heading text/key: ${JSON.stringify(r3.ok ? r3.value.sections[0] : r3.error)}`);
  }

  const r4 = parseCvMarkdown('# Name\n\n## Skills\n- Python\n- Go\n');
  if (r4.ok && r4.value.sections[0].blocks[0].items[0].text === 'Python') {
    pass('bullet Claim.text excludes the "- " marker');
  } else {
    fail(`bullet text: ${JSON.stringify(r4.ok ? r4.value.sections[0].blocks[0] : r4.error)}`);
  }

  // 4. Malformed documents fail closed with a specific, stable error code —
  //    never a thrown exception (§3.3: Result for expected failures).
  const malformed = [
    ['', 'CV_EMPTY'],
    ['   \n  \n', 'CV_EMPTY'],
    ['Not a heading at all', 'CV_MISSING_TITLE'],
    ['## starts with h2 not h1', 'CV_MISSING_TITLE'],
    ['# Title\n\nNo sections here, just prose.', 'CV_NO_SECTIONS'],
    ['# Title\n\n### orphan sub-heading with no ## parent\n', 'CV_HEADING_BEFORE_SECTION'],
    ['# Title\n\n# Second title', 'CV_MULTIPLE_TITLES'],
  ];
  let allCorrect = true;
  for (const [input, expectedCode] of malformed) {
    const r = parseCvMarkdown(input);
    if (r.ok || r.error.code !== expectedCode) {
      allCorrect = false;
      fail(`input ${JSON.stringify(input.slice(0, 30))}: expected ${expectedCode}, got ${r.ok ? 'ok' : r.error.code}`);
    }
  }
  if (allCorrect) pass(`all ${malformed.length} malformed-input cases fail closed with the correct error code`);

  // 5. Non-string input is a Result error, never a thrown TypeError.
  const r5 = parseCvMarkdown(/** @type {any} */ (null));
  if (!r5.ok && r5.error.code === 'CV_PARSE_NOT_A_STRING') pass('non-string input returns an err Result, not a throw');
  else fail(`non-string input: ${JSON.stringify(r5)}`);

  // 6. Consecutive bullet items merge into ONE bullets block, not one per item —
  //    and a paragraph interrupting two bullet runs correctly splits them into two.
  const r6 = parseCvMarkdown('# T\n\n## S\n- a\n- b\ntext between\n- c\n');
  if (r6.ok) {
    const blocks = r6.value.sections[0].blocks;
    const kinds = blocks.map((b) => b.kind).join(',');
    if (kinds === 'bullets,paragraph,bullets' && blocks[0].items.length === 2 && blocks[2].items.length === 1) {
      pass('a paragraph interrupting bullets splits them into two separate bullets blocks');
    } else {
      fail(`blocks: ${JSON.stringify(blocks.map((b) => ({ kind: b.kind, n: b.items?.length })))}`);
    }
  } else {
    fail(`r6 parse failed: ${JSON.stringify(r6.error)}`);
  }

  // 7. sourceHash changes when content changes, and is stable for identical input.
  const a = parseCvMarkdown('# T\n\n## S\ntext\n');
  const b = parseCvMarkdown('# T\n\n## S\ntext\n');
  const c = parseCvMarkdown('# T\n\n## S\ndifferent text\n');
  if (a.ok && b.ok && c.ok && a.value.sourceHash === b.value.sourceHash && a.value.sourceHash !== c.value.sourceHash) {
    pass('sourceHash is stable for identical input and differs when content changes');
  } else {
    fail('sourceHash did not behave as a content fingerprint');
  }

  // 8. CRLF input parses the same as LF input (line-ending normalization).
  const lf = parseCvMarkdown('# T\n\n## S\n- a\n- b\n');
  const crlf = parseCvMarkdown('# T\r\n\r\n## S\r\n- a\r\n- b\r\n');
  if (lf.ok && crlf.ok && lf.value.sections[0].blocks[0].items.map((i) => i.text).join(',') === crlf.value.sections[0].blocks[0].items.map((i) => i.text).join(',')) {
    pass('CRLF input parses identically to LF input');
  } else {
    fail('CRLF line endings produced a different structure than LF');
  }
} catch (e) {
  fail(`core-cv-parse tests crashed: ${e.message}\n${e.stack}`);
}
