// @ts-check
// lib/pipeline-inbox.mjs — the one reader/writer for data/pipeline.md state.
//
// pipeline.md is an inbox whose row state is the checkbox:
//   `- [ ]` pending · `- [x]` processed · `- [!]` error (modes/pipeline.md).
// Before this module three scripts mutated it with three different recipes
// (scan.mjs locked; reconcile-pipeline.mjs and openrouter-runner.mjs did not,
// so they could lose a scanner append), and two incompatible `[x]` encodings
// were written: reconcile MOVED the row to the Processed section, the OpenRouter
// runner flipped it IN PLACE inside Pending.
//
// Contract:
//   - READ is tolerant: every `[x]` form parses (moved, in-place, `~~struck~~`),
//     as do `[ ]` and `[!]`. Section headers are recognised only in the two
//     languages code has always known (Pending/Pendientes, Processed/Procesadas);
//     localized headers from modes/<lang>/ are deliberately NOT parsed.
//   - WRITE is single-form: processed = the row MOVES to the Processed section
//     (the form modes/pipeline.md documents); error = `[!]` in place with a
//     reason. Only the one targeted row changes — every other byte is kept,
//     including line endings.
//   - Every mutation runs under pipeline-lock and lands via tmp+rename, so a
//     concurrent scanner append can neither interleave nor be lost, and a crash
//     can never leave a truncated pipeline.md.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { withPipelineLock } from '../pipeline-lock.mjs';

/** Fresh-install skeleton (same text scan.mjs always created). */
export const PIPELINE_SKELETON = `# Pipeline — Pending URLs

Paste job URLs below as \`- [ ] {url}\` then run \`/jobber pipeline\`.

## Pending

## Processed
`;

// English first, legacy Spanish as fallback — the only headers code has ever parsed.
const PENDING_HEADERS = ['## Pending', '## Pendientes'];
const PROCESSED_HEADERS = ['## Processed', '## Procesadas'];
const PENDING_HEADER_RE = /^##\s+(Pendientes|Pending)\s*$/i;
const PROCESSED_HEADER_RE = /^##\s+(Procesadas|Processed)\s*$/i;
const ROW_RE = /^- \[( |x|X|!)\]\s*(.*)$/;

const CR = '\r';
const LF = '\n';
/** @param {string} l */
const noCr = (l) => (l.endsWith(CR) ? l.slice(0, -1) : l);
/** @param {string} l */
const crOf = (l) => (l.endsWith(CR) ? CR : '');

/**
 * @typedef {object} InboxRow
 * @property {number} index        Line index in the file.
 * @property {'pending'|'processed'|'error'} state
 * @property {'pending'|'processed'|null} section  Recognised section the row sits in, else null.
 * @property {'moved'|'in-place'|null} encoding    Processed rows only: Processed section vs flipped inside Pending.
 * @property {string} url          Best-effort URL ('' when none).
 * @property {string[]} cols       `|`-separated columns of the row body (trimmed).
 * @property {string} raw          The line without its line terminator.
 */

/**
 * Best-effort URL of a row body: first column when it is a URL, else the first URL anywhere.
 * @param {string} body
 */
function bodyUrl(body) {
  const first = body.split(' |')[0].trim();
  if (/^https?:\/\//i.test(first)) return first;
  const m = body.match(/https?:\/\/[^\s|)]+/);
  return m ? m[0] : '';
}

/**
 * Tolerant parse of pipeline.md text. Never throws; unknown lines are skipped.
 * @param {string} text
 * @returns {InboxRow[]}
 */
export function parseInbox(text) {
  /** @type {InboxRow[]} */
  const rows = [];
  /** @type {'pending'|'processed'|null} */
  let section = null;
  text.split(LF).forEach((line, index) => {
    const raw = noCr(line);
    if (/^##\s/.test(raw)) {
      section = PENDING_HEADER_RE.test(raw) ? 'pending' : PROCESSED_HEADER_RE.test(raw) ? 'processed' : null;
      return;
    }
    const m = raw.match(ROW_RE);
    if (!m) return;
    const mark = m[1].toLowerCase();
    const state = mark === ' ' ? 'pending' : mark === 'x' ? 'processed' : 'error';
    const body = m[2];
    rows.push({
      index,
      state,
      section,
      encoding: state === 'processed' ? (section === 'pending' ? 'in-place' : 'moved') : null,
      url: bodyUrl(body.replace(/^~~/, '')),
      cols: body.split('|').map((s) => s.trim()),
      raw,
    });
  });
  return rows;
}

/**
 * Atomic replace; retries the rename briefly because Windows refuses it while a reader holds the file.
 * @param {string} filePath
 * @param {string} content
 */
function writeAtomic(filePath, content) {
  const tmp = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, content, 'utf-8');
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmp, filePath);
        return;
      } catch (err) {
        const code = /** @type {NodeJS.ErrnoException} */ (err).code;
        if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(String(code))) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
      }
    }
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Lock pipeline.md, hand its current text to `fn`, and atomically write the
 * string `fn` returns (any non-string, or identical text, means "no change").
 * `fn` is synchronous so no await can widen the critical section.
 *
 * @param {string} pipelinePath
 * @param {(text: string) => string|null|undefined} fn
 * @param {{createIfMissing?: boolean}} [opts] createIfMissing: seed PIPELINE_SKELETON when absent.
 * @returns {Promise<{changed: boolean}>}
 */
export async function mutatePipeline(pipelinePath, fn, opts = {}) {
  const file = resolve(pipelinePath);
  return withPipelineLock(file, async () => {
    const exists = existsSync(file);
    const text = exists ? readFileSync(file, 'utf-8') : opts.createIfMissing ? PIPELINE_SKELETON : '';
    const next = fn(text);
    if (typeof next !== 'string' || (exists && next === text)) return { changed: false };
    mkdirSync(dirname(file), { recursive: true });
    writeAtomic(file, next);
    return { changed: true };
  });
}

/**
 * Append pending rows (already formatted, no `- [ ]` added here) to the Pending
 * section, creating the skeleton/section when missing. `rows` may be a function
 * of the current text so a caller can dedup against the file inside the lock.
 *
 * @param {string} pipelinePath
 * @param {string[] | ((text: string) => string[])} rows
 * @returns {Promise<{added: number}>}
 */
export async function appendPending(pipelinePath, rows) {
  let added = 0;
  await mutatePipeline(pipelinePath, (text) => {
    const lines = typeof rows === 'function' ? rows(text) : rows;
    if (lines.length === 0) return null;
    added = lines.length;
    const eol = text.includes(CR + LF) ? CR + LF : LF;
    const joined = lines.join(eol);
    const marker = PENDING_HEADERS.find((m) => text.includes(m)) ?? null;
    if (marker === null) {
      // No Pending section — insert one before Processed (or at the end).
      const procIdx = PROCESSED_HEADERS.reduce((found, m) => {
        const i = text.indexOf(m);
        return found === -1 || (i !== -1 && i < found) ? i : found;
      }, -1);
      const at = procIdx === -1 ? text.length : procIdx;
      return `${text.slice(0, at)}${eol}## Pending${eol}${eol}${joined}${eol}${eol}${text.slice(at)}`;
    }
    const after = text.indexOf(marker) + marker.length;
    const next = text.indexOf(`${LF}## `, after);
    let at = next === -1 ? text.length : next;
    if (next !== -1 && text[at - 1] === CR) at -= 1; // keep a CRLF pair intact
    return `${text.slice(0, at)}${eol}${joined}${eol}${text.slice(at)}`;
  }, { createIfMissing: true });
  return { added };
}

/**
 * Index of the first still-pending row whose URL is exactly `url`, or -1.
 * @param {string[]} lines
 * @param {string} url
 */
function findPending(lines, url) {
  return lines.findIndex((l) => {
    const m = noCr(l).match(ROW_RE);
    return m !== null && m[1] === ' ' && bodyUrl(m[2]) === url;
  });
}

/**
 * Single-line, pipe-free, length-capped text safe to embed in a row.
 * @param {unknown} s
 */
function oneLine(s, max = 120) {
  return String(s ?? '').replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Mark the pending row for `url` processed: the row leaves Pending and lands at
 * the top of the Processed section as
 * `- [x] {ref} | {url} | {company} | {role} | {score} | PDF {✅|❌}` (company/role
 * are carried over from the pending row). Idempotent: no pending row → no change.
 *
 * @param {string} pipelinePath
 * @param {string} url Exact URL of the pending row.
 * @param {{ref?: string, score?: string, pdf?: boolean}} [info] ref: `#NNN` or a report link (default `#--`).
 * @returns {Promise<{changed: boolean}>}
 */
export async function markProcessed(pipelinePath, url, info = {}) {
  return mutatePipeline(pipelinePath, (text) => {
    // Raw split: untouched lines keep their own terminators byte for byte.
    const lines = text.split(LF);
    const cr = text.includes(CR + LF) ? CR : '';
    const i = findPending(lines, url);
    if (i < 0) return null;
    const cols = noCr(lines[i]).replace(/^- \[ \]\s*/, '').split('|').map((s) => s.trim());
    const done = `- [x] ${oneLine(info.ref || '#--')} | ${url} | ${cols[1] ?? ''} | ${cols[2] ?? ''} | ${oneLine(info.score || 'N/A')} | PDF ${info.pdf ? '✅' : '❌'}${cr}`;
    lines.splice(i, 1);
    let proc = lines.findIndex((l) => PROCESSED_HEADER_RE.test(l));
    if (proc < 0) {
      // No Processed section: add one at the end in the language of the Pending header.
      const spanish = lines.some((l) => /^##\s+Pendientes\s*$/i.test(l));
      if (lines.length && lines[lines.length - 1].trim() !== '') lines.push(cr);
      lines.push((spanish ? '## Procesadas' : '## Processed') + cr, cr);
      proc = lines.length - 2;
    }
    // Insert directly under the header, after the blank that conventionally follows it.
    const at = lines[proc + 1] !== undefined && lines[proc + 1].trim() === '' ? proc + 2 : proc + 1;
    lines.splice(at, 0, done);
    return lines.join(LF);
  });
}

/**
 * Mark the pending row for `url` as an error in place:
 * `- [!] {original row} — Error: {reason}`. The row keeps its section and every
 * other byte of the file is untouched. Idempotent: no pending row → no change.
 *
 * @param {string} pipelinePath
 * @param {string} url Exact URL of the pending row.
 * @param {string} reason Short reason (collapsed to one line, capped at 120 chars).
 * @returns {Promise<{changed: boolean}>}
 */
export async function markError(pipelinePath, url, reason) {
  return mutatePipeline(pipelinePath, (text) => {
    const lines = text.split(LF);
    const i = findPending(lines, url);
    if (i < 0) return null;
    lines[i] = `${noCr(lines[i]).replace(/^- \[ \]/, '- [!]')} — Error: ${oneLine(reason) || 'unknown'}${crOf(lines[i])}`;
    return lines.join(LF);
  });
}
