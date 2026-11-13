// server/cv.mjs — turn an uploaded CV into plain text, judged by content not file name.
// Pure: Buffer in, result out. No disk, no network.

import { extractPdfText, auditTextLayer } from '../lib/pdf-text.mjs';

export const MAX_CV_BYTES = 5 * 1024 * 1024;

const SECTION_NAMES = new Set([
  'summary', 'profile', 'experience', 'work experience', 'professional experience', 'employment',
  'education', 'skills', 'technical skills', 'core skills', 'key skills', 'projects',
  'certifications', 'languages', 'publications', 'awards', 'references', 'interests',
]);

const fail = (status, error) => ({ ok: false, status, error });
const WRONG_TYPE = 'That file is not a readable PDF, Markdown or plain text file.';

// jd-skill-gap only recognises a "# Skills" heading. Plain-text and PDF CVs write
// a bare "SKILLS" line, so promote known section names to headings.
export function promoteHeadings(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const name = line.trim().replace(/^#{1,4}\s*/, '').replace(/[:*]+$/, '').trim().toLowerCase();
      return SECTION_NAMES.has(name) ? `# ${name[0].toUpperCase()}${name.slice(1)}` : line;
    })
    .join('\n');
}

/**
 * @param {Buffer} buf
 * @param {string} filename
 * @returns {{ok: true, text: string} | {ok: false, status: number, error: string}}
 */
export function readCv(buf, filename) {
  const ext = /\.[^.]+$/.exec(String(filename).toLowerCase())?.[0] ?? '';
  if (!['.pdf', '.md', '.txt'].includes(ext)) return fail(415, WRONG_TYPE);
  if (buf.length === 0) return fail(400, 'That file is empty.');
  if (buf.length > MAX_CV_BYTES) return fail(413, 'That file is too large. The limit is 5 MB.');

  const isPdf = buf.toString('latin1', 0, 5) === '%PDF-';
  if (ext === '.pdf') {
    if (!isPdf) return fail(415, WRONG_TYPE);
    let extracted;
    try { extracted = extractPdfText(buf); } catch { return fail(422, PDF_UNREADABLE); }
    if (!auditTextLayer(extracted.text).ok) return fail(422, PDF_UNREADABLE);
    return { ok: true, text: promoteHeadings(extracted.text) };
  }

  if (isPdf) return fail(415, WRONG_TYPE);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return fail(415, WRONG_TYPE); }
  if (text.includes('\0')) return fail(415, WRONG_TYPE);
  return { ok: true, text: promoteHeadings(text.replace(/^﻿/, '')) };
}

const PDF_UNREADABLE =
  'We could not read the text in this PDF. Many PDFs saved from design tools or scanners have no readable text. Try a Markdown or plain text copy of your CV.';
