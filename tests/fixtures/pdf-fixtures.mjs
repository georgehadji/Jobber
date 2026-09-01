// tests/fixtures/pdf-fixtures.mjs — hand-built minimal PDFs for
// tests/pdf-text-layer.test.mjs, exercising lib/pdf-text.mjs offline (no
// Playwright, no network).
//
// Generated rather than committed as raw binary: buildFixturePdf() emits the
// same object shape real Chromium output uses (verified by rendering an
// actual PDF via Playwright and inspecting its bytes during development —
// see docs/AI-JOB-SEARCH-PORT-PLAN.md Phase 2) — Type0/Identity-H composite
// font with a ToUnicode CMap, classic (non-xref-stream) objects. It does NOT
// emit a byte-accurate xref table or trailer /Root: lib/pdf-text.mjs (like
// generate-pdf.mjs's own countRenderedPdfPages) locates the Catalog and
// Pages by scanning object dictionaries directly, never via xref, so a valid
// xref is unnecessary machinery a hand-built fixture doesn't need to get
// right. A minimal xref/trailer/%%EOF is still appended for realism.

/**
 * @param {{ withToUnicode?: boolean, lines?: string[] }} [options]
 * @returns {Buffer}
 */
export function buildFixturePdf({ withToUnicode = true, lines } = {}) {
  const content = lines ?? [
    'Jane Doe',
    'jane.doe@example.com · +1 555 0100',
    'Experience',
    'Senior Engineer at Acme Corp',
    'Skills',
    'JavaScript, Python',
  ];

  // Assign each unique character an arbitrary 2-byte "CID" — mirroring how a
  // subsetted Identity-H font numbers its glyphs, unrelated to Unicode order.
  const charCodes = new Map();
  let nextCode = 1;
  for (const line of content) {
    for (const ch of line) {
      if (!charCodes.has(ch)) charCodes.set(ch, nextCode++);
    }
  }
  const hex4 = (n) => n.toString(16).padStart(4, '0');
  const encodeLine = (line) => [...line].map((ch) => hex4(charCodes.get(ch))).join('');

  let y = 20;
  const ops = [];
  for (const line of content) {
    ops.push(`BT\n/F1 12 Tf\n1 0 0 -1 10 ${y} Tm\n<${encodeLine(line)}> Tj\nET`);
    y += 20;
  }
  const contentStream = ops.join('\n');

  const objects = [];
  objects.push({ id: '1 0', dict: '<</Type /Catalog /Pages 2 0 R>>' });
  objects.push({ id: '2 0', dict: '<</Type /Pages /Count 1 /Kids [3 0 R]>>' });
  objects.push({
    id: '3 0',
    dict: '<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
      + '/Resources <</ProcSet [/PDF /Text] /Font <</F1 4 0 R>>>> /Contents 6 0 R>>',
  });
  objects.push({
    id: '4 0',
    dict: '<</Type /Font /Subtype /Type0 /BaseFont /FixtureTest /Encoding /Identity-H '
      + `/DescendantFonts [5 0 R]${withToUnicode ? ' /ToUnicode 7 0 R' : ''}>>`,
  });
  objects.push({
    id: '5 0',
    dict: '<</Type /Font /Subtype /CIDFontType2 /BaseFont /FixtureTest '
      + '/CIDSystemInfo <</Registry (Adobe) /Ordering (Identity) /Supplement 0>> /CIDToGIDMap /Identity>>',
  });
  objects.push({
    id: '6 0',
    dict: `<</Length ${Buffer.byteLength(contentStream, 'latin1')}>>`,
    stream: contentStream,
  });
  if (withToUnicode) {
    const bfchars = [...charCodes.entries()]
      .map(([ch, code]) => `<${hex4(code)}> <${hex4(ch.codePointAt(0))}>`)
      .join('\n');
    const cmap = [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo <</Registry (Adobe) /Ordering (UCS) /Supplement 0>> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      `${charCodes.size} beginbfchar`,
      bfchars,
      'endbfchar',
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n');
    objects.push({ id: '7 0', dict: `<</Length ${Buffer.byteLength(cmap, 'latin1')}>>`, stream: cmap });
  }

  let pdf = '%PDF-1.4\n';
  for (const obj of objects) {
    pdf += `${obj.id} obj\n${obj.dict}\n`;
    if (obj.stream !== undefined) {
      pdf += `stream\n${obj.stream}\nendstream\n`;
    }
    pdf += 'endobj\n';
  }
  // Inert placeholder xref/trailer: present for shape, never read by
  // lib/pdf-text.mjs (see module header).
  pdf += `xref\n0 ${objects.length + 1}\ntrailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n0\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}
