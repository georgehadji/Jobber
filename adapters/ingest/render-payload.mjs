// @ts-check
// adapters/ingest/render-payload.mjs — CV render payload (JSON) → CvDocument.
//
// The payload written to /tmp/cv-{candidate}-{company}.json by modes/pdf.md
// step 17 is the structured, fact-gated, TAILORED content that both
// build-cv-html.mjs and build-cv-plaintext.mjs render from. That makes it the
// right thing to measure keyword coverage against: cv.md is the untailored
// source, and the HTML/PDF are downstream renderings whose markup would have
// to be stripped back off. The payload is the tailoring itself.
//
// It also happens to carry section identity for free. Its top-level keys
// (`summary`, `competencies`, `experience`, `projects`, `education`,
// `certifications`, `skills`) are already exactly the canonical section keys
// core/cv/model.mjs's sectionKey() resolves markdown headings to, so
// core/tailoring/coverage.mjs's evidence-section distinction applies without
// any heading-matching guesswork.
//
// Adapter, not core: it does I/O-shaped work (parsing an external format) and
// is where the payload's schema quirks are absorbed. core/ stays unaware that
// a render payload exists.

import { ok, err, domainError } from '../../core/shared/result.mjs';
import { fingerprint, normalizeWhitespace } from '../../core/shared/text.mjs';

/** Matches the ingest ceiling in adapters/ingest/markdown.mjs. */
const MAX_PAYLOAD_BYTES = 256 * 1024;

// Payload key → the order sections appear in the produced CvDocument. The keys
// are canonical section keys already; this list also defines which top-level
// payload fields are treated as CV content at all, so an unknown field added to
// the payload later is ignored rather than silently becoming a section.
const SECTION_ORDER = ['summary', 'competencies', 'experience', 'projects', 'education', 'certifications', 'skills'];

/**
 * Locate a string in the raw JSON source and build a real SourceSpan for it.
 *
 * A cursor advances monotonically so repeated strings (two bullets with the
 * same text, a role title reused across employers) get distinct offsets rather
 * than all pointing at the first occurrence. When a string cannot be located
 * verbatim — it was assembled from several payload fields, e.g. an experience
 * heading built from company + role + dates — the span collapses to the cursor
 * position with the assembled text. That keeps SourceSpan honest about the
 * text while still pointing into the right region of the file.
 *
 * @param {string} raw
 * @param {{ pos: number }} cursor
 * @param {string} text
 * @returns {import('../../core/cv/model.mjs').SourceSpan}
 */
function spanFor(raw, cursor, text) {
  const found = text ? raw.indexOf(text, cursor.pos) : -1;
  const start = found === -1 ? cursor.pos : found;
  const end = found === -1 ? cursor.pos : found + text.length;
  if (found !== -1) cursor.pos = end;
  // Lines are 1-indexed and counted by '\n' boundaries, matching how
  // core/cv/parse.mjs numbers them.
  let line = 1;
  for (let i = 0; i < start && i < raw.length; i++) {
    if (raw.charCodeAt(i) === 10) line++;
  }
  return { start, end, line, text, contentHash: fingerprint(normalizeWhitespace(text)) };
}

/**
 * @param {string} raw
 * @param {{ pos: number }} cursor
 * @param {string} text
 * @param {import('../../core/cv/model.mjs').ClaimKind} kind
 * @returns {import('../../core/cv/model.mjs').Claim}
 */
function claim(raw, cursor, text, kind) {
  const normalized = normalizeWhitespace(text);
  return { text: normalized, kind, source: spanFor(raw, cursor, text) };
}

/**
 * Coerce a payload value that may be a string or an array of strings into a
 * single display string. The schema permits both for `skills[].items`.
 *
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join(', ');
  return '';
}

/**
 * Coerce a payload value into a list of trimmed, non-empty strings.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringList(value) {
  return (Array.isArray(value) ? value : []).map(asText).map((s) => s.trim()).filter(Boolean);
}

/**
 * Join the non-empty parts of a composed line (e.g. role + company + dates)
 * with a separator, so a payload that omits `location` does not produce
 * "Acme —  — 2020".
 *
 * @param {Array<unknown>} parts
 * @returns {string}
 */
function joinParts(parts) {
  return parts.map(asText).map((s) => s.trim()).filter(Boolean).join(' — ');
}

/**
 * Build the blocks for one payload section.
 *
 * @param {string} key
 * @param {unknown} value
 * @param {string} raw
 * @param {{ pos: number }} cursor
 * @returns {import('../../core/cv/model.mjs').Block[]}
 */
function blocksFor(key, value, raw, cursor) {
  /** @type {import('../../core/cv/model.mjs').Block[]} */
  const blocks = [];

  if (key === 'summary') {
    const text = asText(value).trim();
    if (text) blocks.push({ kind: 'paragraph', claim: claim(raw, cursor, text, 'paragraph') });
    return blocks;
  }

  if (key === 'competencies') {
    const items = asStringList(value);
    if (items.length) blocks.push({ kind: 'bullets', items: items.map((t) => claim(raw, cursor, t, 'bullet')) });
    return blocks;
  }

  if (key === 'skills') {
    const items = (Array.isArray(value) ? value : [])
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return asText(entry).trim();
        const category = asText(/** @type {any} */ (entry).category).trim();
        const list = asText(/** @type {any} */ (entry).items).trim();
        return category && list ? `${category}: ${list}` : (list || category);
      })
      .filter(Boolean);
    if (items.length) blocks.push({ kind: 'bullets', items: items.map((t) => claim(raw, cursor, t, 'bullet')) });
    return blocks;
  }

  if (key === 'experience') {
    for (const entry of Array.isArray(value) ? value : []) {
      if (!entry || typeof entry !== 'object') continue;
      const e = /** @type {any} */ (entry);
      const heading = joinParts([e.role, e.company, e.location, e.dates]);
      if (heading) blocks.push({ kind: 'heading', level: 3, claim: claim(raw, cursor, heading, 'heading') });
      const bullets = asStringList(e.bullets);
      if (bullets.length) blocks.push({ kind: 'bullets', items: bullets.map((t) => claim(raw, cursor, t, 'bullet')) });
    }
    return blocks;
  }

  if (key === 'projects') {
    for (const entry of Array.isArray(value) ? value : []) {
      if (!entry || typeof entry !== 'object') continue;
      const p = /** @type {any} */ (entry);
      const heading = joinParts([p.name, p.badge]);
      if (heading) blocks.push({ kind: 'heading', level: 3, claim: claim(raw, cursor, heading, 'heading') });
      const body = joinParts([p.tech, p.description]);
      if (body) blocks.push({ kind: 'paragraph', claim: claim(raw, cursor, body, 'paragraph') });
    }
    return blocks;
  }

  // education | certifications — same entry shape.
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== 'object') continue;
    const e = /** @type {any} */ (entry);
    const text = joinParts([e.title, e.org, e.year, e.description]);
    if (text) blocks.push({ kind: 'paragraph', claim: claim(raw, cursor, text, 'paragraph') });
  }
  return blocks;
}

/**
 * Parse a CV render payload into a CvDocument.
 *
 * @param {unknown} text - Raw JSON source of the payload.
 * @returns {import('../../core/shared/result.mjs').Result<import('../../core/cv/model.mjs').CvDocument, import('../../core/shared/result.mjs').DomainError>}
 */
export function ingestRenderPayload(text) {
  if (typeof text !== 'string') {
    return err(domainError('PAYLOAD_NOT_A_STRING', 'Expected the payload source as a string.'));
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) {
    return err(domainError(
      'PAYLOAD_TOO_LARGE',
      `Payload is ${bytes} bytes (limit ${MAX_PAYLOAD_BYTES}).`,
      { bytes, limit: MAX_PAYLOAD_BYTES }
    ));
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return err(domainError('PAYLOAD_INVALID_JSON', `Payload is not valid JSON: ${/** @type {Error} */ (e).message}`));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return err(domainError('PAYLOAD_NOT_AN_OBJECT', 'Payload must be a JSON object.'));
  }

  const candidate = parsed.candidate && typeof parsed.candidate === 'object' ? parsed.candidate : {};
  const name = asText(candidate.name).trim();
  if (!name) {
    return err(domainError('PAYLOAD_MISSING_NAME', 'Payload has no candidate.name to use as the document title.'));
  }

  const cursor = { pos: 0 };
  const title = claim(text, cursor, name, 'heading');

  // Contact details become the preamble, mirroring where a markdown CV puts
  // them (directly under the `# ` title) so core/cv/score/contact.mjs sees the
  // same shape from either source.
  const contactParts = [
    asText(candidate.location),
    asText(candidate.email),
    asText(candidate.phone),
    asText(candidate.linkedin?.display ?? candidate.linkedin?.url),
    asText(candidate.github?.display ?? candidate.github?.url),
    asText(candidate.portfolio?.display ?? candidate.portfolio?.url),
  ].map((s) => s.trim()).filter(Boolean);

  /** @type {import('../../core/cv/model.mjs').Block[]} */
  const preamble = [];
  if (contactParts.length) {
    const contactLine = contactParts.join(' · ');
    preamble.push({ kind: 'paragraph', claim: claim(text, cursor, contactLine, 'paragraph') });
  }

  // Display titles for headings come from payload.sections when present, but
  // the SECTION KEY is always the payload key — never the display title. A CV
  // rendered in another language labels its experience section "Doświadczenie",
  // and resolving that back through sectionKey() would be a needless round trip
  // through a translation table the payload has already made unnecessary.
  const displayTitles = parsed.sections && typeof parsed.sections === 'object' ? parsed.sections : {};

  /** @type {import('../../core/cv/model.mjs').Section[]} */
  const sections = [];
  for (const key of SECTION_ORDER) {
    if (!(key in parsed)) continue;
    const blocks = blocksFor(key, parsed[key], text, cursor);
    if (!blocks.length) continue;
    const heading = asText(displayTitles[key]).trim() || key;
    sections.push({ key, heading: claim(text, cursor, heading, 'heading'), blocks });
  }

  if (!sections.length) {
    return err(domainError('PAYLOAD_NO_SECTIONS', 'Payload contains no recognized CV sections with content.'));
  }

  return ok({ title, preamble, sections, sourceHash: fingerprint(text) });
}
