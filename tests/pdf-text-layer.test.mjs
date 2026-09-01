// tests/pdf-text-layer.test.mjs — lib/pdf-text.mjs (ATS text-layer
// verification for generate-pdf.mjs's output). Fully offline: fixtures are
// hand-built by tests/fixtures/pdf-fixtures.mjs, no Playwright, no network.
import { pass, fail } from './helpers.mjs';
import { extractPdfText, auditTextLayer } from '../lib/pdf-text.mjs';
import { buildFixturePdf } from './fixtures/pdf-fixtures.mjs';

console.log('\nlib/pdf-text.mjs — PDF text-layer extraction and audit');

try {
  // 1. Clean fixture: full extraction, in stream order.
  const clean = buildFixturePdf();
  const { text, perPage, warnings } = extractPdfText(clean);
  if (
    text.includes('Jane Doe') &&
    text.includes('jane.doe@example.com') &&
    text.includes('Senior Engineer at Acme Corp')
  ) {
    pass('extractPdfText decodes a Type0/Identity-H + ToUnicode content stream');
  } else {
    fail(`extractPdfText missed expected content: ${JSON.stringify(text)}`);
  }
  if (warnings.length === 0) {
    pass('a well-formed fixture extracts with zero warnings');
  } else {
    fail(`unexpected warnings on a clean fixture: ${JSON.stringify(warnings)}`);
  }
  if (perPage.length === 1) {
    pass('perPage reports one entry for a one-page fixture');
  } else {
    fail(`expected 1 page, got ${perPage.length}`);
  }

  // 2. Non-ASCII glyph round-trips through the ToUnicode CMap.
  if (text.includes('·')) {
    pass('a non-ASCII glyph (middle dot) decodes correctly via ToUnicode');
  } else {
    fail(`non-ASCII glyph did not round-trip: ${JSON.stringify(text)}`);
  }

  // 3. Contact details present as literal text — the check an ATS parser
  //    actually performs (an icon-glyph-only contact detail is invisible to
  //    a real parser the way it would be here too).
  const auditClean = auditTextLayer(text, {
    mustContain: ['jane.doe@example.com', '+1 555 0100'],
    expectedOrder: ['Jane Doe', 'Experience', 'Senior Engineer', 'Skills'],
  });
  if (auditClean.ok && auditClean.findings.length === 0) {
    pass('auditTextLayer passes a clean fixture: contact literals + reading order');
  } else {
    fail(`auditTextLayer wrongly failed a clean fixture: ${JSON.stringify(auditClean)}`);
  }

  // 4. MANDATORY negative case: a font with no ToUnicode CMap must FAIL the
  //    audit, not silently pass. A check that cannot fail proves nothing.
  const noToUnicode = buildFixturePdf({ withToUnicode: false });
  const decoded = extractPdfText(noToUnicode);
  const auditBroken = auditTextLayer(decoded.text, {});
  if (!auditBroken.ok && auditBroken.findings.some((f) => f.code === 'CID_PLACEHOLDER')) {
    pass('auditTextLayer FAILS a font with no ToUnicode CMap (CID_PLACEHOLDER)');
  } else {
    fail(`auditTextLayer wrongly passed an unreadable font: ${JSON.stringify(auditBroken)}`);
  }
  if (decoded.warnings.some((w) => /no usable ToUnicode/.test(w))) {
    pass('extractPdfText warns when a font has no usable ToUnicode CMap');
  } else {
    fail(`expected a ToUnicode warning, got: ${JSON.stringify(decoded.warnings)}`);
  }

  // 5. Reading-order violation is caught, not silently accepted.
  const orderAudit = auditTextLayer(text, {
    expectedOrder: ['Skills', 'Jane Doe'], // reversed — Skills is the LAST line
  });
  if (!orderAudit.ok && orderAudit.findings.some((f) => f.code === 'ORDER_MISMATCH')) {
    pass('auditTextLayer catches a reading-order violation (ORDER_MISMATCH)');
  } else {
    fail(`auditTextLayer missed a real order violation: ${JSON.stringify(orderAudit)}`);
  }

  // 6. A missing contact detail is caught, not silently accepted.
  const missingAudit = auditTextLayer(text, { mustContain: ['+44 20 7946 0000'] });
  if (!missingAudit.ok && missingAudit.findings.some((f) => f.code === 'MISSING_TEXT')) {
    pass('auditTextLayer catches a contact detail absent from the text layer');
  } else {
    fail(`auditTextLayer missed an absent contact detail: ${JSON.stringify(missingAudit)}`);
  }

  // 7. Empty extraction is its own failure, short-circuiting other checks.
  const emptyAudit = auditTextLayer('   ', { mustContain: ['anything'] });
  if (!emptyAudit.ok && emptyAudit.findings.length === 1 && emptyAudit.findings[0].code === 'EMPTY_EXTRACTION') {
    pass('auditTextLayer reports EMPTY_EXTRACTION and stops there');
  } else {
    fail(`auditTextLayer handled empty text incorrectly: ${JSON.stringify(emptyAudit)}`);
  }

  // 8. A replacement character in the text layer is flagged.
  const replacementAudit = auditTextLayer('Jane Doe � Engineer');
  if (!replacementAudit.ok && replacementAudit.findings.some((f) => f.code === 'REPLACEMENT_CHAR')) {
    pass('auditTextLayer flags a U+FFFD replacement character');
  } else {
    fail(`auditTextLayer missed a replacement character: ${JSON.stringify(replacementAudit)}`);
  }

  // 9. Non-PDF input degrades to an empty, warned extraction — never throws.
  const notAPdf = extractPdfText(Buffer.from('not a pdf at all'));
  if (notAPdf.text === '' && notAPdf.warnings.length > 0) {
    pass('extractPdfText degrades gracefully on non-PDF input (no throw)');
  } else {
    fail(`non-PDF input was not handled gracefully: ${JSON.stringify(notAPdf)}`);
  }

  // 10. buildFixturePdf emits a single page; confirm perPage[0] equals the
  //     joined text for that case — the invariant multi-page callers
  //     (generate-pdf.mjs) rely on perPage tracking pageIds 1:1.
  if (perPage.length === 1 && perPage[0] === text) {
    pass('a single-page document: perPage[0] equals the joined text');
  } else {
    fail(`single-page perPage/text mismatch: ${JSON.stringify({ perPage, text })}`);
  }
} catch (e) {
  fail(`pdf-text-layer tests crashed: ${e.message}\n${e.stack}`);
}
