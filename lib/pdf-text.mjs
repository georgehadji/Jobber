// @ts-check
// lib/pdf-text.mjs — extract and audit the text layer of a PDF generate-pdf.mjs
// produced, the way an ATS (applicant tracking system) parser actually reads
// it: from the embedded text-showing operators, not the rendered page.
//
// Scope (see docs/AI-JOB-SEARCH-PORT-PLAN.md Phase 2): this is a validator for
// Jobber's own Chromium output, not a general PDF parser. It assumes the
// structure Chromium's headless PDF export actually produces (verified by
// rendering real PDFs with Playwright and inspecting the bytes):
//   - classic (non-cross-reference-stream) objects: every object appears as a
//     literal "N G obj ... endobj" span in the file — no /ObjStm, no
//     compressed xref. countRenderedPdfPages() in generate-pdf.mjs already
//     relies on this same assumption, successfully, in production.
//   - text shown via Type0/CIDFontType2 fonts, /Encoding /Identity-H (or
//     /Identity-V), 2-byte character codes, with an embedded /ToUnicode CMap
//     (beginbfchar/beginbfrange) — or via simple (1-byte) fonts with the same
//     ToUnicode convention.
// A PDF outside this shape (hand-authored, from another tool, encrypted,
// linearized with object streams) is expected to fail extraction and report a
// warning rather than crash — "unreadable" is an acceptable answer here.
//
// Pure module: extractPdfText/auditTextLayer take a Buffer/string and return
// a value. No filesystem or network IO. Callers (generate-pdf.mjs) own
// reading the PDF bytes and writing any --dump-text output.

import { inflateSync } from 'node:zlib';

const MAX_INFLATED_BYTES = 32 * 1024 * 1024; // decompression-bomb guard per object stream

// ── Object model: the same regex-object-walk as countRenderedPdfPages ──────

/**
 * Parse every "N G obj ... endobj" span in a classic (non-xref-stream) PDF.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Map<string, {dict: string, streamStart: number, streamEnd: number}>}
 *   keyed by "objNum genNum"; streamStart/streamEnd are byte offsets into
 *   pdfBuffer's latin1 view (Buffer.byteLength-compatible since PDF stream
 *   data is treated as opaque bytes, not decoded text) — -1 when the object
 *   has no stream.
 */
function parseObjects(pdfBuffer) {
  const text = pdfBuffer.toString('latin1');
  const objects = new Map();
  const objectPattern = /(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj\b/g;
  let match;
  while ((match = objectPattern.exec(text))) {
    const bodyStart = match.index + match[0].indexOf(match[3]);
    const streamKeyword = match[3].match(/\bstream(?:\r\n|\n|\r)/);
    if (!streamKeyword) {
      objects.set(`${match[1]} ${match[2]}`, { dict: match[3], streamStart: -1, streamEnd: -1 });
      continue;
    }
    const dict = match[3].slice(0, streamKeyword.index);
    const dataStart = bodyStart + streamKeyword.index + streamKeyword[0].length;
    const relEnd = match[3].indexOf('endstream', streamKeyword.index);
    const dataEnd = relEnd === -1 ? dataStart : bodyStart + relEnd;
    objects.set(`${match[1]} ${match[2]}`, { dict, streamStart: dataStart, streamEnd: dataEnd });
  }
  return objects;
}

/**
 * Resolve an object's raw stream bytes, inflating FlateDecode when present.
 * Returns null (with a warning pushed) rather than throwing, so one
 * unreadable stream never aborts extraction of the rest of the document.
 *
 * @param {Buffer} pdfBuffer
 * @param {{dict: string, streamStart: number, streamEnd: number}} obj
 * @param {string[]} warnings
 * @returns {Buffer|null}
 */
function readStream(pdfBuffer, obj, warnings) {
  if (obj.streamStart === -1) return null;
  const raw = pdfBuffer.subarray(obj.streamStart, obj.streamEnd);
  if (!/\/Filter\s*[\[/]*\s*\/FlateDecode/.test(obj.dict)) return raw;
  try {
    return inflateSync(raw, { maxOutputLength: MAX_INFLATED_BYTES });
  } catch (err) {
    warnings.push(`could not inflate a FlateDecode stream: ${err.message}`);
    return null;
  }
}

/**
 * @param {string} dict
 * @param {RegExp} pattern - must have exactly one capture group.
 * @returns {string|null}
 */
function dictField(dict, pattern) {
  const m = dict.match(pattern);
  return m ? m[1] : null;
}

/**
 * Follow the Catalog → Pages tree and return Page object ids in document
 * (left-to-right Kids) order. Mirrors countRenderedPdfPages's traversal but
 * collects leaf Page ids instead of just a count.
 *
 * @param {Map<string, {dict: string}>} objects
 * @returns {string[]}
 */
function orderedPageIds(objects) {
  const catalogId = [...objects.entries()].find(([, o]) => /\/Type\s*\/Catalog\b/.test(o.dict))?.[0];
  const catalog = catalogId ? objects.get(catalogId) : null;
  const rootPagesRef = catalog ? dictField(catalog.dict, /\/Pages\s+(\d+\s+\d+)\s+R\b/) : null;
  if (!rootPagesRef) return [];

  const pageIds = [];
  const seen = new Set();
  const walk = (ref) => {
    if (!ref || seen.has(ref)) return; // cycle guard
    seen.add(ref);
    const node = objects.get(ref);
    if (!node) return;
    if (/\/Type\s*\/Page\b(?!s)/.test(node.dict)) {
      pageIds.push(ref);
      return;
    }
    const kidsList = dictField(node.dict, /\/Kids\s*\[([^\]]*)\]/);
    if (!kidsList) return;
    for (const kidMatch of kidsList.matchAll(/(\d+)\s+(\d+)\s+R/g)) {
      walk(`${kidMatch[1]} ${kidMatch[2]}`);
    }
  };
  walk(rootPagesRef);
  return pageIds;
}

// ── ToUnicode CMap parsing (functional, pure string → Map) ─────────────────

/**
 * Parse a ToUnicode CMap stream's bfchar/bfrange blocks into code→string.
 * Handles both the sequential-offset bfrange form
 * (`<start> <end> <dstStart>`) and the explicit-array form
 * (`<start> <end> [<dst1> <dst2> ...]`).
 *
 * @param {string} cmapText
 * @returns {{ codeToChar: Map<number, string>, codeByteWidth: number }}
 */
function parseToUnicodeCMap(cmapText) {
  const codeToChar = new Map();
  const rangeMatch = cmapText.match(/begincodespacerange\s*<([0-9a-fA-F]+)>\s*<[0-9a-fA-F]+>/);
  const codeByteWidth = rangeMatch ? Math.max(1, Math.ceil(rangeMatch[1].length / 2)) : 2;

  const hexToChar = (hex) => {
    // A ToUnicode destination is UTF-16BE; decode pairs of hex bytes.
    const bytes = [];
    for (let i = 0; i < hex.length; i += 4) bytes.push(parseInt(hex.slice(i, i + 4), 16));
    try {
      return String.fromCharCode(...bytes);
    } catch {
      return '';
    }
  };

  for (const block of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      codeToChar.set(parseInt(entry[1], 16), hexToChar(entry[2]));
    }
  }

  for (const block of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    // Array form first (more specific pattern), then the sequential form.
    for (const entry of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g)) {
      const start = parseInt(entry[1], 16);
      const dests = [...entry[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((d) => hexToChar(d[1]));
      dests.forEach((ch, i) => codeToChar.set(start + i, ch));
    }
    const withoutArrays = block[1].replace(/<[0-9a-fA-F]+>\s*<[0-9a-fA-F]+>\s*\[[^\]]*\]/g, '');
    for (const entry of withoutArrays.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const start = parseInt(entry[1], 16);
      const end = parseInt(entry[2], 16);
      const dstStart = parseInt(entry[3], 16);
      for (let code = start; code <= end && code - start < 65536; code++) {
        codeToChar.set(code, String.fromCharCode(dstStart + (code - start)));
      }
    }
  }

  return { codeToChar, codeByteWidth };
}

// ── Font resource resolution ────────────────────────────────────────────

/**
 * Find the `<<...>>` dict that starts at or after `fromIndex`, honoring
 * nesting depth. A naive non-greedy regex (`<<[\s\S]*?>>`) stops at the
 * FIRST `>>`, which is wrong the moment a dict nests another dict — and
 * Chromium's own Page /Resources always does (ExtGState and Font both sit
 * inside it): `<</ProcSet [...] /ExtGState <</G3 3 0 R>> /Font <<...>>>>`.
 * A non-greedy match on that string truncates at ExtGState's `>>` and never
 * reaches /Font at all.
 *
 * @param {string} text
 * @param {number} fromIndex
 * @returns {{ content: string, end: number } | null}
 */
function findBalancedDict(text, fromIndex) {
  const openIdx = text.indexOf('<<', fromIndex);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < text.length; ) {
    if (text.startsWith('<<', i)) { depth++; i += 2; continue; }
    if (text.startsWith('>>', i)) {
      depth--;
      i += 2;
      if (depth === 0) return { content: text.slice(openIdx + 2, i - 2), end: i };
      continue;
    }
    i++;
  }
  return null; // unbalanced — malformed or truncated input
}

/**
 * Build resourceName → decoder for every /Font entry in a Page's Resources.
 *
 * @param {Map<string, {dict: string, streamStart: number, streamEnd: number}>} objects
 * @param {string} pageDict
 * @param {Buffer} pdfBuffer
 * @param {string[]} warnings
 * @returns {Map<string, {codeToChar: Map<number, string>, codeByteWidth: number, hasToUnicode: boolean}>}
 */
function resolveFonts(objects, pageDict, pdfBuffer, warnings) {
  const decoders = new Map();
  const resourcesRef = dictField(pageDict, /\/Resources\s+(\d+\s+\d+)\s+R\b/);
  let resourcesDict;
  if (resourcesRef) {
    resourcesDict = objects.get(resourcesRef)?.dict ?? '';
  } else {
    const idx = pageDict.indexOf('/Resources');
    resourcesDict = idx === -1 ? '' : (findBalancedDict(pageDict, idx)?.content ?? '');
  }

  const fontDictRefMatch = resourcesDict.match(/\/Font\s+(\d+\s+\d+)\s+R\b/);
  let fontBlockText;
  if (fontDictRefMatch) {
    fontBlockText = objects.get(fontDictRefMatch[1])?.dict;
  } else {
    const fontIdx = resourcesDict.indexOf('/Font');
    fontBlockText = fontIdx === -1 ? undefined : findBalancedDict(resourcesDict, fontIdx)?.content;
  }
  if (!fontBlockText) return decoders;

  for (const entry of fontBlockText.matchAll(/\/([A-Za-z0-9#.+-]+)\s+(\d+)\s+(\d+)\s+R/g)) {
    const [, name, num, gen] = entry;
    const fontObj = objects.get(`${num} ${gen}`);
    if (!fontObj) continue;
    const isComposite = /\/Subtype\s*\/Type0\b/.test(fontObj.dict);
    const toUnicodeRef = dictField(fontObj.dict, /\/ToUnicode\s+(\d+\s+\d+)\s+R\b/);
    if (toUnicodeRef && objects.has(toUnicodeRef)) {
      const cmapBytes = readStream(pdfBuffer, objects.get(toUnicodeRef), warnings);
      if (cmapBytes) {
        const { codeToChar, codeByteWidth } = parseToUnicodeCMap(cmapBytes.toString('latin1'));
        decoders.set(name, { codeToChar, codeByteWidth, hasToUnicode: true });
        continue;
      }
    }
    // No usable ToUnicode: still record the font so text extraction can emit
    // (cid:N) placeholders at the right byte width, rather than silently
    // dropping the run.
    decoders.set(name, {
      codeToChar: new Map(),
      codeByteWidth: isComposite ? 2 : 1,
      hasToUnicode: false,
    });
  }
  return decoders;
}

// ── Content stream operator walk ────────────────────────────────────────

/**
 * Decode one PDF hex string's bytes into text using a font decoder, chunked
 * to the font's code byte width. An undecodable code becomes `(cid:N)`,
 * which auditTextLayer treats as a hard failure signal.
 *
 * @param {string} hex
 * @param {{codeToChar: Map<number, string>, codeByteWidth: number}} decoder
 * @returns {string}
 */
function decodeHexRun(hex, decoder) {
  const width = decoder.codeByteWidth * 2; // hex digits per code
  let out = '';
  for (let i = 0; i + width <= hex.length; i += width) {
    const code = parseInt(hex.slice(i, i + width), 16);
    const ch = decoder.codeToChar.get(code);
    out += ch !== undefined ? ch : `(cid:${code})`;
  }
  return out;
}

/**
 * Walk one page's (already-decompressed) content stream and extract text in
 * stream-encounter order — which is the visual reading order for the
 * single-column templates this validates (see module header for scope).
 *
 * @param {string} content
 * @param {Map<string, {codeToChar: Map<number, string>, codeByteWidth: number, hasToUnicode: boolean}>} fonts
 * @param {string[]} warnings
 * @returns {string}
 */
function extractContentText(content, fonts, warnings) {
  let currentFont = null;
  let sawTf = false;
  let out = '';
  let lastTy = null;

  const emit = (hex) => {
    if (!currentFont) {
      // A resolvable-font-not-found warning already fired at the Tf that
      // selected it; only warn here for the (malformed-content) case of a
      // text-showing operator with no Tf at all seen yet.
      if (!sawTf) warnings.push('text-showing operator encountered before any Tf font selection');
      return;
    }
    out += decodeHexRun(hex, currentFont);
  };

  // Track Tf (font selection), Tm (absolute text matrix — used only to
  // detect a new visual line for spacing between runs), Tj/'/" (single
  // string), and TJ (array of strings + kerning numbers).
  const opPattern = /\/([A-Za-z0-9#.+-]+)\s+[\d.]+\s+Tf|(-?[\d.]+)\s+(-?[\d.]+)\s+Td|1\s+0\s+0\s+-?1\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|<([0-9a-fA-F]*)>\s*Tj|\[((?:<[0-9a-fA-F]*>|-?[\d.]+|\s)*)\]\s*TJ|<([0-9a-fA-F]*)>\s*'/g;

  let match;
  while ((match = opPattern.exec(content))) {
    if (match[1] !== undefined) {
      sawTf = true;
      currentFont = fonts.get(match[1]) || null;
      if (!fonts.has(match[1])) warnings.push(`no font resource found for /${match[1]}`);
    } else if (match[5] !== undefined) {
      const ty = Number(match[5]);
      if (lastTy !== null && ty !== lastTy && out && !out.endsWith('\n')) out += '\n';
      lastTy = ty;
    } else if (match[6] !== undefined) {
      emit(match[6]);
    } else if (match[7] !== undefined) {
      for (const piece of match[7].matchAll(/<([0-9a-fA-F]*)>/g)) emit(piece[1]);
    } else if (match[8] !== undefined) {
      if (out && !out.endsWith('\n')) out += '\n';
      emit(match[8]);
    }
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Extract the text layer from a PDF the way an ATS parser reads it: from the
 * embedded text-showing operators of each page's content stream, decoded
 * through the active font's ToUnicode CMap.
 *
 * @param {Buffer} buffer - PDF bytes, as written by generate-pdf.mjs.
 * @returns {{ text: string, perPage: string[], warnings: string[] }}
 */
export function extractPdfText(buffer) {
  const warnings = [];
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.toString('latin1', 0, 5) !== '%PDF-') {
    return { text: '', perPage: [], warnings: ['input is not a PDF (missing %PDF- header)'] };
  }

  const objects = parseObjects(buffer);
  const pageIds = orderedPageIds(objects);
  if (pageIds.length === 0) {
    return { text: '', perPage: [], warnings: ['could not resolve any /Page objects from the catalog'] };
  }

  const perPage = [];
  for (const pageId of pageIds) {
    const pageObj = objects.get(pageId);
    const fonts = resolveFonts(objects, pageObj.dict, buffer, warnings);
    if ([...fonts.values()].some((f) => !f.hasToUnicode)) {
      warnings.push(`page ${pageId}: at least one font has no usable ToUnicode CMap`);
    }

    const contentsRef = dictField(pageObj.dict, /\/Contents\s+(\d+\s+\d+)\s+R\b/);
    const contentsList = dictField(pageObj.dict, /\/Contents\s*\[([^\]]*)\]/);
    const refs = contentsRef ? [contentsRef]
      : contentsList ? [...contentsList.matchAll(/(\d+)\s+(\d+)\s+R/g)].map((m) => `${m[1]} ${m[2]}`)
        : [];

    let pageText = '';
    for (const ref of refs) {
      const streamObj = objects.get(ref);
      if (!streamObj) continue;
      const bytes = readStream(buffer, streamObj, warnings);
      if (!bytes) continue;
      pageText += extractContentText(bytes.toString('latin1'), fonts, warnings);
    }
    perPage.push(pageText);
  }

  return { text: perPage.join('\n'), perPage, warnings };
}

/** @typedef {{ code: string, message: string }} Finding */

/**
 * Audit an extracted text layer against the checks an ATS parseability
 * review actually cares about (ported from the source repo's /apply
 * checklist — see docs/AI-JOB-SEARCH-PORT-PLAN.md Phase 2).
 *
 * @param {string} text - `extractPdfText(...).text`.
 * @param {{ mustContain?: string[], expectedOrder?: string[] }} [checks]
 * @returns {{ ok: boolean, findings: Finding[] }}
 */
export function auditTextLayer(text, { mustContain = [], expectedOrder = [] } = {}) {
  /** @type {Finding[]} */
  const findings = [];
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();

  if (normalized.length === 0) {
    findings.push({ code: 'EMPTY_EXTRACTION', message: 'the text layer extracted to nothing' });
    return { ok: false, findings }; // every other check is meaningless on empty text
  }

  if (normalized.includes('(cid:')) {
    findings.push({
      code: 'CID_PLACEHOLDER',
      message: 'one or more glyphs have no ToUnicode mapping and extracted as (cid:N) placeholders',
    });
  }
  if (normalized.includes('�')) {
    findings.push({ code: 'REPLACEMENT_CHAR', message: 'the text layer contains U+FFFD replacement characters' });
  }

  for (const required of mustContain) {
    const needle = String(required).replace(/\s+/g, ' ').trim();
    if (needle && !normalized.includes(needle)) {
      findings.push({ code: 'MISSING_TEXT', message: `required text not found in the extraction: ${JSON.stringify(required)}` });
    }
  }

  let searchFrom = 0;
  for (const item of expectedOrder) {
    const needle = String(item).replace(/\s+/g, ' ').trim();
    if (!needle) continue;
    const idx = normalized.indexOf(needle, searchFrom);
    if (idx === -1) {
      findings.push({ code: 'ORDER_MISMATCH', message: `expected text out of order or missing: ${JSON.stringify(item)}` });
      break;
    }
    searchFrom = idx + needle.length;
  }

  return { ok: findings.length === 0, findings };
}
