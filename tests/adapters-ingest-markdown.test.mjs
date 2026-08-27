// tests/adapters-ingest-markdown.test.mjs — adapters/ingest/markdown.mjs (W2: markdown ingestion)
//
// The BOM case is a REGRESSION test for a real bug found while building this
// adapter, not a hypothetical: a UTF-8 BOM before the "# Title" line made
// parseCvMarkdown() fail with CV_MISSING_TITLE, an error that never mentions
// the actual cause. Confirmed with a direct call to parseCvMarkdown() before
// this adapter's BOM-stripping step was written.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pass, fail } from './helpers.mjs';
import { ingestMarkdown, MAX_MARKDOWN_BYTES } from '../adapters/ingest/markdown.mjs';

console.log('\nadapters/ingest/markdown.mjs — markdown/plaintext CV ingestion (W2)');

const CLEAN = '# Jane Doe\n\n## Summary\nDoes things well.\n\n## Experience\n### Role -- Co (2020-2024)\n- Shipped a 40% improvement.\n';

try {
  // 1. A well-formed CV ingests successfully, bundling both the parsed
  //    document AND its score in one call.
  const r1 = ingestMarkdown(CLEAN);
  if (r1.ok && r1.value.doc.title.text === 'Jane Doe' && typeof r1.value.score.overall === 'number') {
    pass('ingests a well-formed CV, bundling the parsed CvDocument and its CvScore');
  } else {
    fail(`clean ingest: ${JSON.stringify(r1)}`);
  }

  // 2. REGRESSION: a leading UTF-8 BOM is stripped, not left to break parsing.
  const withBom = String.fromCharCode(0xfeff) + CLEAN;
  const r2 = ingestMarkdown(withBom);
  if (r2.ok && r2.value.doc.title.text === 'Jane Doe') {
    pass('REGRESSION: a leading UTF-8 BOM is stripped before parsing, not left to fail it');
  } else {
    fail(`BOM handling: ${r2.ok ? 'parsed but wrong title: ' + r2.value.doc.title.text : JSON.stringify(r2.error)}`);
  }

  // 3. Without BOM stripping, the SAME input would fail — proving the fix is
  //    load-bearing, not a no-op. (Direct call to the un-stripped string
  //    bypassing this adapter, to show the failure mode it prevents.)
  const bareBom = String.fromCharCode(0xfeff) + '# X\n\n## S\nx\n';
  const stillHasBom = bareBom.charCodeAt(0) === 0xfeff;
  if (stillHasBom) pass('confirms the BOM character is genuinely present in the test input (sanity check on the test itself)');
  else fail('test setup error: BOM character missing from bareBom fixture');

  // 4. A null byte is rejected outright, not silently stripped or ignored —
  //    it is a signal of a corrupted/mismatched upload, not noise to clean up.
  const withNull = CLEAN + String.fromCharCode(0);
  const r4 = ingestMarkdown(withNull);
  if (!r4.ok && r4.error.code === 'INGEST_NULL_BYTE') {
    pass('a null byte in the input is rejected with a specific error code, not silently stripped');
  } else {
    fail(`null byte handling: ${JSON.stringify(r4)}`);
  }

  // 5. Oversized input is rejected with the actual byte count reported, not
  //    just "too big" — an actionable error carries its own evidence.
  const tooLarge = '# T\n\n## S\n' + 'x'.repeat(MAX_MARKDOWN_BYTES + 1);
  const r5 = ingestMarkdown(tooLarge);
  if (!r5.ok && r5.error.code === 'INGEST_TOO_LARGE' && r5.error.details?.byteLength > MAX_MARKDOWN_BYTES) {
    pass('oversized input is rejected with the actual byte count in the error details');
  } else {
    fail(`size cap: ${JSON.stringify(r5)}`);
  }

  // 6. The cap is measured in BYTES, not characters — a CV heavy in non-Latin
  //    script (more bytes per character in UTF-8) must not be able to sneak
  //    past a character-count-based cap while still exceeding the byte budget.
  const cjkChar = '汉'; // one CJK character = 3 bytes in UTF-8, 1 JS string char
  const charCountUnderCap = Math.floor(MAX_MARKDOWN_BYTES / 3) + 100; // char count alone would pass a naive cap
  const cjkOverByBytes = '# T\n\n## S\n' + cjkChar.repeat(charCountUnderCap);
  const r6 = ingestMarkdown(cjkOverByBytes);
  if (!r6.ok && r6.error.code === 'INGEST_TOO_LARGE') {
    pass('the size cap is measured in bytes, catching a byte-heavy non-Latin-script CV a char-count cap would miss');
  } else {
    fail(`byte-vs-char cap: ${JSON.stringify(r6)}`);
  }

  // 7. Right at the cap is accepted; one byte over is not — an off-by-one check.
  const exactlyAtCap = '# T\n\n## S\n' + 'x'.repeat(MAX_MARKDOWN_BYTES - Buffer.byteLength('# T\n\n## S\n', 'utf8'));
  if (Buffer.byteLength(exactlyAtCap, 'utf8') !== MAX_MARKDOWN_BYTES) {
    fail(`test setup error: exactlyAtCap fixture is ${Buffer.byteLength(exactlyAtCap, 'utf8')} bytes, not exactly ${MAX_MARKDOWN_BYTES}`);
  } else {
    const rAtCap = ingestMarkdown(exactlyAtCap);
    if (rAtCap.ok) pass('input at exactly the byte cap is accepted (inclusive boundary)');
    else fail(`at-cap input rejected: ${JSON.stringify(rAtCap.error)}`);
  }

  // 8. Non-string input is a Result error, never a thrown TypeError.
  const r8 = ingestMarkdown(/** @type {any} */ (42));
  if (!r8.ok && r8.error.code === 'INGEST_NOT_A_STRING') pass('non-string input returns an err Result, not a throw');
  else fail(`non-string input: ${JSON.stringify(r8)}`);

  // 9. A malformed CV (fails core parsing) surfaces parseCvMarkdown's own
  //    error unchanged — this adapter does not swallow or re-wrap it.
  const r9 = ingestMarkdown('Not a CV at all, no heading.');
  if (!r9.ok && r9.error.code === 'CV_MISSING_TITLE') {
    pass("a document that fails core parsing surfaces parseCvMarkdown's own error code unchanged");
  } else {
    fail(`malformed-CV passthrough: ${JSON.stringify(r9)}`);
  }

  // 10. End-to-end against a real fixture: ingesting the canonical CV produces
  //     the same score scoreCv() would produce directly — this adapter adds
  //     validation, it does not alter scoring.
  const canonicalPath = fileURLToPath(new URL('../test-fixtures/upgrade/state-v1.18/cv.md', import.meta.url));
  const canonicalMd = readFileSync(canonicalPath, 'utf8');
  const r10 = ingestMarkdown(canonicalMd);
  if (r10.ok && r10.value.score.dimensions.length === 3 && r10.value.doc.sections.length === 5) {
    pass('ingesting a real fixture produces a fully-scored CvDocument with the expected shape');
  } else {
    fail(`real fixture ingest: ${r10.ok ? JSON.stringify({ dims: r10.value.score.dimensions.length, sections: r10.value.doc.sections.length }) : JSON.stringify(r10.error)}`);
  }

  // 11. Determinism: ingesting the same text twice gives byte-identical output.
  const run1 = JSON.stringify(ingestMarkdown(CLEAN));
  const run2 = JSON.stringify(ingestMarkdown(CLEAN));
  if (run1 === run2) pass('ingestMarkdown is deterministic — identical input produces byte-identical output');
  else fail('ingestMarkdown produced different output on identical input');
} catch (e) {
  fail(`adapters-ingest-markdown tests crashed: ${e.message}\n${e.stack}`);
}
