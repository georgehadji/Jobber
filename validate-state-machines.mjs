#!/usr/bin/env node
// validate-state-machines.mjs — the state-machine ratchet (STATE-MACHINES-PLAN §4.7, Phase 5.1).
//
//   node validate-state-machines.mjs [--json] [--root DIR]
//
// Fails (exit 1, one line per violation naming file:line) when:
//   1. a tracked source file outside the registry / generated blocks / allowlist hard-codes 3+
//      canonical application-status labels in one array literal, switch, object literal,
//      `a | b | c` union or shell pattern (the labels come from templates/states.yml);
//   2. a file that no machine lists under `writers:` writes a machine's persisted file
//      (data/applications.md, data/status-log.tsv, batch/batch-state.tsv, ...);
//   3. a generated block is stale (gen-machine-docs.mjs --check, batch/gen-states.mjs --check);
//   4. (delegated) web / Go / root-script lists vs the registry — see "Rule 4" below.
// Rules 1 and 2 have a checked-in allowlist (tests/fixtures/state-literal-allowlist.json) seeded
// with today's sites. It may only shrink: a NEW site fails, and so does a STALE entry that no
// longer matches anything, so cleaning a site up forces its entry out.
//
// LIMITS (AGENTS.md absence-check clause): this is a static text scan, not a parser. It reads
// string literals, bracket nesting and `a | b` chains, and resolves a path variable only through
// simple `const X = ...;` / `X := ...` / `X=...` assignments. A determined rewrite can still evade
// it (build labels by concatenation, pass a path through an object field or a callback, keep the
// list in a regex alternation, or call the write through an alias). It errs towards false
// positives in the direction of "add it to the allowlist and look at it"; it never claims a clean
// bill of health for code it cannot read. Regex literals containing quotes can desync the
// tokenizer for the rest of that LINE only (strings never span lines). Test files are skipped by
// rule 2 (they write sandbox copies), not by rule 1.
//
// Rule 4: the per-runtime parity checks already run in the suite and are NOT re-run here, because
// they are test files that execute on import (no importable function): tests/status-list-parity.test.mjs
// (root scripts + Go dashboard, pinned allowlist), test-all.mjs section 55.3b and
// web/test-state-model.mjs (web lists), tests/state-machine.test.mjs. Rule 1 is the net under them
// for any NEW hard-coded list in any of those languages.
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';
import { listMachines, loadMachine } from './lib/state-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ALLOWLIST_REL = 'tests/fixtures/state-literal-allowlist.json';
const SRC_EXT = /\.(mjs|ts|tsx|go|sh)$/;
const SKIP_PATH = /(^|\/)(node_modules|vendor|\.next|\.claude|dist|build)(\/|$)|^tests\/fixtures\/|^templates\/(states\.yml|machines\/)/;
const TEST_FILE = /(^|\/)(tests?|test-fixtures)\/|(^|\/)test-[^/]*\.mjs$|-tests?\.mjs$|\.test\.(mjs|ts|tsx)$|_test\.go$/;

// ── file set ────────────────────────────────────────────────────────────────
function walk(dir, root, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    const rel = relative(root, full).replace(/\\/g, '/');
    if (e.isDirectory()) { if (!SKIP_PATH.test(rel + '/') && e.name !== '.git') walk(full, root, out); } else out.push(rel);
  }
}

/** Tracked source files (git ls-files; plain directory walk when `root` is not a git repo). */
export function sourceFiles(root) {
  let all;
  try {
    all = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf-8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  } catch { all = []; walk(root, root, all); }
  return all.map(f => f.replace(/\\/g, '/')).filter(f => SRC_EXT.test(f) && !SKIP_PATH.test(f) && existsSync(join(root, f))).sort();
}

/** Blank out generated regions (`# >>> machine:... <<< machine:...`) so their lines still count. */
function stripGenerated(text) {
  return text.replace(/^[^\n]*>>> machine:[^\n]*\n[\s\S]*?^[^\n]*<<< machine:[^\n]*$/gm, m => m.replace(/[^\n]/g, ' '));
}

// ── rule 1: hard-coded canonical state lists ───────────────────────────────
function canonicalWords(root) {
  const m = loadMachine('application-status', { root });
  return new Set(m.states.flatMap(s => [s.id, s.label]).map(w => w.toLowerCase()));
}

function labelsIn(text, words, splitRe) {
  const hit = new Set();
  for (const piece of text.replace(/\*\*/g, '').split(splitRe)) { const w = piece.trim().toLowerCase(); if (words.has(w)) hit.add(w); }
  return hit;
}

/** JS / TS / Go: string literals grouped by enclosing [] or {} and by `|` chains. */
function scanBracketed(src, words) {
  const groups = [];
  const stack = [];
  let line = 1, i = 0, chain = null, lastTok = '';
  const flushChain = () => { if (chain && chain.labels.size >= 3) groups.push({ line: chain.line, labels: chain.labels }); chain = null; };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++;
      i = stop; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const start = line; let j = i + 1, body = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { body += src[j + 1] ?? ''; j += 2; continue; }
        if (src[j] === '\n') { if (c !== '`') break; line++; }
        body += src[j++];
      }
      i = src[j] === c ? j + 1 : j;
      const got = labelsIn(body, words, /[|,]/);
      if (got.size) {
        const top = stack[stack.length - 1];
        if (top && (top.ch === '[' || top.ch === '{')) for (const l of got) { top.labels.add(l); top.line ??= start; }
        if (lastTok === '|' && chain) for (const l of got) chain.labels.add(l);
        else { flushChain(); chain = { labels: new Set(got), line: start }; }
      } else if (!(lastTok === '|' && chain)) flushChain();
      lastTok = 'str';
      continue;
    }
    if (c === '[' || c === '{' || c === '(') { flushChain(); stack.push({ ch: c, labels: new Set(), line: null, open: line }); lastTok = c; i++; continue; }
    if (c === ']' || c === '}' || c === ')') {
      flushChain();
      const g = stack.pop();
      if (g && (g.ch === '[' || g.ch === '{') && g.labels.size >= 3) groups.push({ line: g.line ?? g.open, labels: g.labels });
      lastTok = c; i++; continue;
    }
    if (c === '|' && src[i + 1] !== '|') { lastTok = '|'; i++; continue; }
    if (c === ',' && lastTok === 'str') { i++; continue; }
    flushChain(); lastTok = c; i++;
  }
  flushChain();
  return groups;
}

/** Shell: quoted words / `case` patterns / unquoted `a|b|c)` alternations, one group per line piece. */
function scanShell(src, words) {
  const groups = [];
  src.split('\n').forEach((raw, n) => {
    const text = raw.replace(/^\s*#.*$/, '');
    for (const m of text.matchAll(/"([^"\n]*)"|'([^'\n]*)'|^\s*([A-Za-z0-9_|*\s-]+)\)/g)) {
      const got = labelsIn(m[1] ?? m[2] ?? m[3] ?? '', words, /[\s|,]+/);
      if (got.size >= 3) groups.push({ line: n + 1, labels: got });
    }
  });
  return groups;
}

/** Every hard-coded state-list site: [{file, line, sig}] where sig = sorted labels joined by ",". */
export function findStateLiterals(root) {
  const words = canonicalWords(root);
  const out = [];
  for (const f of sourceFiles(root)) {
    const text = stripGenerated(readFileSync(join(root, f), 'utf-8'));
    for (const g of f.endsWith('.sh') ? scanShell(text, words) : scanBracketed(text, words)) {
      out.push({ file: f, line: g.line, sig: [...g.labels].sort().join(',') });
    }
  }
  return out;
}

// ── rule 2: writers of persisted files ──────────────────────────────────────
const PATH_RE = /\b(?:data|batch)\/[A-Za-z0-9_.-]+\.(?:md|tsv|json)\b/g;
const WRITE_NAME = /(write|append|rename|copyfile|save|atomic|createwritestream|\.puts|tee|truncate)/i;
const COPY_NAME = /(rename|copy|move)/i;
// Two persisted files are reached through helpers, not a path literal; name those helpers/vars here.
// shortcut: hand-listed names, add one when a new helper resolves a persisted path without its basename.
const HINTS = {
  'applications.md': { ident: /\b(?:resolveTrackerPath|APPS_FILE|APPLICATIONS_(?:FILE|PATH)|TRACKER_(?:FILE|PATH))\b/, notCall: /^appendStatusLog$/ },
  'status-log.tsv': { ident: /\b(?:STATUS_LOG(?:_\w+)?|ledgerPath|statusLogPath)\b/, call: /^appendStatusLog$/ },
};

/** {basename -> {path, machines:Set, writers:Set}} for every machine with a concrete persisted file. */
export function persistedFiles(root) {
  const map = new Map();
  for (const id of listMachines({ root })) {
    const m = loadMachine(id, { root });
    for (const p of String(m.persisted_in ?? '').match(PATH_RE) ?? []) {
      const e = map.get(basename(p)) ?? { path: p, machines: new Set(), writers: new Set() };
      e.machines.add(id);
      for (const w of m.writers) e.writers.add(w.replace(/\\/g, '/'));
      map.set(basename(p), e);
    }
  }
  return map;
}

function splitArgs(s) {
  const args = []; let depth = 0, cur = '', q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') cur += s[++i] ?? ''; else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    if (c === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    cur += c;
  }
  args.push(cur);
  return args;
}

/** Identifiers whose assignment mentions the file's basename (directly or via another tainted name). */
function taintedNames(text, base, isSh) {
  const rhs = isSh ? /^\s*(?:export\s+|local\s+)?([A-Za-z_]\w*)=([^\n]*)/gm
    : /(?:\b(?:const|let|var)\s+)?\b([A-Za-z_$][\w$]*)\s*(?::=|=(?!=|>))\s*([^;\n]*(?:\n[^;\n]*){0,3}?(?:;|$))/gm;
  const decls = [...text.matchAll(rhs)].map(m => [m[1], m[2]]);
  const tainted = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, r] of decls) {
      // reading a tracked file, or taking its directory, does not make the result that file's path
      if (tainted.has(name) || /\b\w*read\w*\s*\(|dirname\s*\(/i.test(r)) continue;
      if (r.includes(base) || HINTS[base]?.ident.test(r) || [...tainted].some(t => new RegExp(`(?<![\\w$])${t.replace(/\$/g, '\\$')}(?![\\w$])`).test(r))) { tainted.add(name); changed = true; }
    }
  }
  return tainted;
}

const mentions = (arg, base, tainted) => arg.includes(base) || HINTS[base]?.ident.test(arg) || [...tainted].some(t => new RegExp(`(?<![\\w$])\\$?\\{?${t.replace(/\$/g, '\\$')}(?![\\w$])`).test(arg));
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

/** [{line, base}] write sites in `text` whose target mentions one of the persisted file basenames. */
export function writeSites(text, bases, isSh) {
  const hits = [];
  for (const base of bases) {
    const tainted = taintedNames(text, base, isSh);
    if (isSh) {
      text.split('\n').forEach((l, n) => {
        if (/^\s*#/.test(l)) return;
        const targets = [...l.matchAll(/(?:^|[^>&0-9-])>>?\s*(\S+)/g)].map(m => m[1]);
        const cmd = l.match(/\b(?:mv|cp|tee)\b(.*)/); if (cmd) targets.push(cmd[1]);
        if (targets.some(t => mentions(t, base, tainted))) hits.push({ line: n + 1, base });
      });
      continue;
    }
    for (const m of text.matchAll(/(?<![\w$])((?:\w+\.)*\w*)\s*\(/g)) {
      const fn = m[1].split('.').pop();
      if (HINTS[base]?.notCall?.test(fn)) continue;
      if (HINTS[base]?.call?.test(fn)) { hits.push({ line: lineOf(text, m.index), base }); continue; }
      if (!WRITE_NAME.test(m[1])) continue;
      const args = splitArgs(text.slice(m.index + m[0].length, m.index + m[0].length + 600));
      const target = COPY_NAME.test(m[1]) ? args.slice(0, 2) : args.slice(0, 1);
      if (target.some(a => mentions(a, base, tainted))) hits.push({ line: lineOf(text, m.index), base });
    }
  }
  return hits;
}

/** Every write of a persisted file by a file that no machine lists in `writers:`. */
export function findUnlistedWriters(root) {
  const files = persistedFiles(root);
  const bases = [...files.keys()];
  const out = [];
  for (const f of sourceFiles(root)) {
    if (TEST_FILE.test(f) || f === 'validate-state-machines.mjs') continue;
    const text = stripGenerated(readFileSync(join(root, f), 'utf-8'));
    const seen = new Set();
    for (const h of writeSites(text, bases, f.endsWith('.sh'))) {
      const e = files.get(h.base);
      if (e.writers.has(f) || seen.has(h.base)) continue;
      seen.add(h.base);
      out.push({ file: f, line: h.line, path: e.path, machines: [...e.machines].sort() });
    }
  }
  return out;
}

// ── rule 3: generated blocks ────────────────────────────────────────────────
function staleBlocks(root) {
  const out = [];
  const docs = spawnSync(process.execPath, [join(HERE, 'gen-machine-docs.mjs'), '--check', '--root', root], { encoding: 'utf-8', timeout: 120000 });
  if (docs.status !== 0) {
    const lines = (docs.stderr || docs.stdout || '').trim().split('\n').filter(Boolean);
    for (const l of lines.length ? lines : [`gen-machine-docs exited ${docs.status}`]) {
      const m = l.match(/^(?:stale|error): ([^:\s]+?)(?::(\d+))?[: ]/);
      out.push({ file: m?.[1] ?? 'gen-machine-docs.mjs', line: m?.[2] ? Number(m[2]) : 0, message: l });
    }
  }
  const gen = join(root, 'batch', 'gen-states.mjs');
  if (existsSync(gen) && existsSync(join(root, 'batch', 'batch-runner.sh'))) {
    const r = spawnSync(process.execPath, [gen, '--check'], { encoding: 'utf-8', timeout: 60000 });
    if (r.status !== 0) out.push({ file: 'batch/batch-runner.sh', line: 0, message: (r.stderr || r.stdout || `gen-states exited ${r.status}`).trim() });
  }
  return out;
}

// ── allowlist + driver ──────────────────────────────────────────────────────
function loadAllowlist(root) {
  const p = join(root, ALLOWLIST_REL);
  if (!existsSync(p)) return { rule1: {}, rule2: {} };
  const a = JSON.parse(readFileSync(p, 'utf-8'));
  return { rule1: a.rule1 ?? {}, rule2: a.rule2 ?? {} };
}

/** Subtract allowlist entries (one entry absorbs one finding, so a second identical site is NEW). */
function ratchet(rule, findings, allow, keyOf, describe) {
  const left = new Map(Object.entries(allow).map(([f, e]) => [f, [...e]]));
  const out = [];
  for (const f of findings) {
    const entries = left.get(f.file) ?? [];
    const i = entries.indexOf(keyOf(f));
    if (i !== -1) entries.splice(i, 1); else out.push({ rule, file: f.file, line: f.line, kind: 'new', message: describe(f) });
  }
  for (const [file, entries] of left) for (const e of entries) {
    out.push({ rule, file, line: 0, kind: 'stale-allowlist', message: `stale allowlist entry ${JSON.stringify(e)} in ${ALLOWLIST_REL} no longer matches anything — delete it` });
  }
  return out;
}

export function validate(root) {
  const allow = loadAllowlist(root);
  const lits = findStateLiterals(root);
  const writers = findUnlistedWriters(root);
  const violations = [
    ...ratchet(1, lits, allow.rule1, f => f.sig,
      f => `hard-coded state list [${f.sig}] — derive it from the registry (templates/states.yml, lib/state-machine.mjs) or, if unavoidable, add it to ${ALLOWLIST_REL}`),
    ...ratchet(2, writers, allow.rule2, f => f.path,
      f => `writes ${f.path} (${f.machines.join(', ')}) but is not in any machine's writers: list — declare it in the machine yml or add it to ${ALLOWLIST_REL}`),
    ...staleBlocks(root).map(b => ({ rule: 3, file: b.file, line: b.line, kind: 'stale-block', message: b.message })),
  ];
  return { violations, found: { rule1: lits, rule2: writers } };
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx === -1 ? HERE : resolve(argv[rootIdx + 1] ?? '');
  const bad = argv.filter((a, i) => a.startsWith('--') && !['--json', '--root'].includes(a) || (a === '--root' && !argv[i + 1]));
  if (bad.length || !existsSync(root) || !statSync(root).isDirectory()) {
    console.error('Usage: node validate-state-machines.mjs [--json] [--root DIR]');
    return 2;
  }
  const { violations, found } = validate(root);
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ok: violations.length === 0, violations, found }, null, 2));
  } else if (violations.length) {
    for (const v of violations) console.error(`rule ${v.rule}: ${v.file}${v.line ? `:${v.line}` : ''}: ${v.message}`);
    console.error(`\n${violations.length} state-machine violation(s)`);
  } else {
    console.log(`state machines OK (${found.rule1.length} allowlisted state lists, ${found.rule2.length} allowlisted writers, generated blocks fresh)`);
  }
  return violations.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
