// lib/machine-blocks.mjs — generated state-machine blocks in Markdown (STATE-MACHINES-PLAN §4.4 / Phase 4.4).
//
// A block is the text between two HTML-comment markers:
//   <!-- machine:<id>[:<view>] begin -->  ...generated...  <!-- machine:<id>[:<view>] end -->
// Everything between the markers is rewritten from the registry; nothing outside is ever touched.
// Block views (table, list) occupy their own lines; inline views (inline, later) sit in the
// middle of a sentence, so the markers can be placed mid-line.
//
// This module is pure (no file writes, no process exit) and has no YAML dependency: the
// machine description is passed in by the caller (gen-machine-docs.mjs), so translation
// freshness tooling can import the strip/sha helpers without pulling in js-yaml.
import { execFileSync } from 'child_process';

export const DEFAULT_VIEW = 'list';

export class MarkerError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'MarkerError';
    this.line = line ?? null;
  }
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
const MARKER_START = /<!--\s*machine:/g;
const MARKER_STRICT = /<!-- machine:([a-z][a-z0-9-]*)(?::([a-z][a-z0-9-]*))? (begin|end) -->/y;

/**
 * Locate every block in `text`.
 * @returns {{id:string, view:string, line:number, bodyStart:number, bodyEnd:number}[]}
 *   bodyStart/bodyEnd delimit the generated region (exclusive of the markers).
 * @throws {MarkerError} on a malformed marker, an `end` with no `begin`, a nested or
 *   mismatched `begin`/`end`, or a `begin` that is never closed.
 */
export function findBlocks(text) {
  const blocks = [];
  let open = null;
  MARKER_START.lastIndex = 0;
  let m;
  while ((m = MARKER_START.exec(text)) !== null) {
    MARKER_STRICT.lastIndex = m.index;
    const mk = MARKER_STRICT.exec(text);
    const line = lineOf(text, m.index);
    if (!mk) throw new MarkerError('Malformed machine marker (expected "<!-- machine:<id>[:<view>] begin|end -->")', line);
    const [whole, id, view = DEFAULT_VIEW, kind] = mk;
    const name = `machine:${id}${mk[2] ? `:${mk[2]}` : ''}`;
    if (kind === 'begin') {
      if (open) throw new MarkerError(`Unbalanced markers: "${name} begin" inside the still-open block "${open.name}" from line ${open.line}`, line);
      open = { id, view, name, line, bodyStart: m.index + whole.length };
    } else {
      if (!open) throw new MarkerError(`Unbalanced markers: "${name} end" has no matching begin`, line);
      if (open.name !== name) throw new MarkerError(`Unbalanced markers: "${name} end" closes the block "${open.name}" opened at line ${open.line}`, line);
      blocks.push({ id, view, line: open.line, bodyStart: open.bodyStart, bodyEnd: m.index });
      open = null;
    }
  }
  if (open) throw new MarkerError(`Unbalanced markers: "${open.name} begin" is never closed`, open.line);
  return blocks;
}

export const hasMarkers = text => text.includes('<!-- machine:');

/**
 * `text` with every generated region emptied (markers kept). Lenient on purpose: it never
 * throws, so tooling that only compares prose can still run on a file with a broken marker.
 * Line endings are normalised to LF so the comparison ignores autocrlf.
 */
export function stripMachineBlocks(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/(<!-- machine:[^>]*? begin -->)[\s\S]*?(<!-- machine:[^>]*? end -->)/g, '$1$2');
}

// ── views ────────────────────────────────────────────────────────

const tick = s => `\`${s}\``;
const cell = s => String(s).replace(/\|/g, '\\|');
const suffix = s => (s.terminal ? ' (terminal)' : '');

/** Longest simple path from `initial` over the declared edges (first-found wins ties). */
function spine(d) {
  let best = [d.initial];
  const walk = (id, path) => {
    if (path.length > best.length) best = [...path];
    for (const t of d.transitions[id] ?? []) if (!path.includes(t)) walk(t, [...path, t]);
  };
  walk(d.initial, [d.initial]);
  return best;
}

/** view -> {inline:boolean, render(describe-output) -> string[] | string} */
export const VIEWS = {
  // The "state / when to use" table AGENTS.md shows.
  table: { inline: false, render: d => [
    '| State | When to use |',
    '|-------|-------------|',
    ...d.states.map(s => `| ${tick(s.label)} | ${cell(s.description)}${suffix(s)} |`),
  ] },
  // `Label` = description bullets.
  list: { inline: false, render: d => d.states.map(s => `- ${tick(s.label)} = ${s.description}${suffix(s)}`) },
  // `A` → `B` → `C` / `D`: the longest forward path from the initial state, then its last
  // state together with every state off that path, as alternatives.
  inline: { inline: true, render: d => {
    const path = spine(d);
    const label = id => tick(d.states.find(s => s.id === id).label);
    const rest = d.states.filter(s => !path.includes(s.id)).map(s => tick(s.label));
    const tail = [label(path[path.length - 1]), ...rest].join(' / ');
    return [...path.slice(0, -1).map(label), tail].join(' → ');
  } },
  // Plain comma list of every state after the initial one, declaration order.
  later: { inline: true, render: d => d.states.filter(s => s.id !== d.initial).map(s => s.label).join(', ') },
};

/** The text that belongs between a block's markers, given the machine's describe() output. */
export function renderBlock(d, view, eol = '\n') {
  const v = VIEWS[view];
  if (!v) throw new MarkerError(`Unknown view "${view}". Known views: ${Object.keys(VIEWS).join(', ')}`);
  const out = v.render(d);
  return v.inline ? out : eol + out.join(eol) + eol;
}

/**
 * Regenerate every block of `text`.
 * @param {string} text
 * @param {(id:string) => object} describeById  machine id -> describe() output (may throw)
 * @returns {{text:string, blocks:{id:string, view:string, line:number, stale:boolean}[]}}
 *   `text` is `input` byte-identical outside the markers; the file's EOL style is used inside.
 */
export function regenerate(text, describeById) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const found = findBlocks(text);
  let out = '';
  let pos = 0;
  const blocks = [];
  for (const b of found) {
    let body;
    try { body = renderBlock(describeById(b.id), b.view, eol); } catch (e) {
      throw new MarkerError(e.message, b.line);
    }
    blocks.push({ id: b.id, view: b.view, line: b.line, stale: text.slice(b.bodyStart, b.bodyEnd) !== body });
    out += text.slice(pos, b.bodyStart) + body;
    pos = b.bodyEnd;
  }
  return { text: out + text.slice(pos), blocks };
}

// ── translation freshness ─────────────────────────────────────────

/**
 * The newest commit that changed `relPath` OTHER than by regenerating its machine blocks:
 * commits whose only effect is different text between markers are skipped, so regenerating a
 * block never makes translations of that file look stale. Returns null when git cannot say.
 * Control: a commit that edits prose outside the markers (or introduces the markers, which
 * replaces hand-written text) still counts.
 */
export function sourceShaIgnoringBlocks(cwd, relPath) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const show = (rev, p) => { try { return git(['show', `${rev}:${p}`]); } catch { return null; } };
  let commits;
  try { commits = git(['log', '--format=%H', '--', relPath]).split('\n').map(s => s.trim()).filter(Boolean); } catch { return null; }
  for (const c of commits) {
    const cur = show(c, relPath);
    const prev = show(`${c}^`, relPath);
    if (cur === null || prev === null || stripMachineBlocks(cur) !== stripMachineBlocks(prev)) return c;
  }
  return commits[commits.length - 1] ?? null;
}
