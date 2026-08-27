#!/usr/bin/env node
// @ts-check
// validate-core-purity.mjs — enforces that core/ stays a pure domain core.
//
// This guard is load-bearing for the whole architecture (POLYTONIC-PLAN §2.1).
// The commercial position is a *published, reproducible* scoring methodology:
// a given (CvDocument, JobPosting, rubricVersion) must always yield the same
// score, on any machine, on any day. That property is worth exactly as much as
// its weakest import. One `Date.now()` reached for in a tie-breaker, or one
// config file read at module scope, and scores silently stop being replayable —
// with no test failing, because the drift only shows up across runs.
//
// So the rule is mechanical rather than a matter of judgement, and it is
// checked rather than documented:
//
//   core/ may import only from core/. Nothing else. No Node builtins, no
//   third-party packages, and no ambient non-determinism (clock, randomness,
//   environment, filesystem).
//
// I/O is not banned from the codebase — it is banned from *here*. It belongs in
// adapters/, behind a port, where it can be swapped and tested. A domain module
// that needs the time takes it as an argument.
//
// Scanning strips comments and string literals first: a comment explaining why
// Math.random is forbidden must not itself fail the build.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const CORE_DIR = join(ROOT, 'core');

// --capabilities contract (T4): machine-readable flag list for
// validate-mode-invocations.mjs — exits 0 with JSON, before any scanning.
if (process.argv.includes('--capabilities')) {
  console.log(JSON.stringify({
    script: 'validate-core-purity.mjs', version: 1,
    flags: ['--json', '--dir', '--help', '--capabilities'],
    description: 'Enforce that core/ imports no I/O, packages, or non-determinism',
  }));
  process.exit(0);
}

if (process.argv.includes('--help')) {
  console.log(`validate-core-purity.mjs — enforce the purity of the domain core

Usage:
  node validate-core-purity.mjs [--dir <path>] [--json]

Exits 1 when any module under core/ imports a Node builtin, imports a
third-party package, or reaches for ambient non-determinism.`);
  process.exit(0);
}

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

/**
 * Patterns for ambient non-determinism. Each is matched against source that has
 * already had comments and string literals removed.
 *
 * `new Date(...)` with an argument is deterministic, so only the zero-argument
 * form is flagged alongside Date.now().
 */
const NONDETERMINISM = [
  { re: /\bDate\s*\.\s*now\s*\(/, what: 'Date.now()', fix: 'take the timestamp as a parameter' },
  { re: /\bnew\s+Date\s*\(\s*\)/, what: 'new Date()', fix: 'take the timestamp as a parameter' },
  { re: /\bMath\s*\.\s*random\s*\(/, what: 'Math.random()', fix: 'take a seed or the value as a parameter' },
  { re: /\bperformance\s*\.\s*now\s*\(/, what: 'performance.now()', fix: 'measure in the calling shell' },
  { re: /\bprocess\s*\.\s*(env|argv|cwd|platform|exit)\b/, what: 'process.*', fix: 'pass configuration in as an argument' },
  { re: /\bglobalThis\s*\.\s*fetch\b|(?<![.\w])fetch\s*\(/, what: 'fetch()', fix: 'move the call to an adapter behind the Fetcher port' },
  { re: /\bcrypto\s*\.\s*randomUUID\s*\(/, what: 'crypto.randomUUID()', fix: 'take the id as a parameter' },
];

/**
 * Remove comments and string/template literals so their contents cannot trip
 * the scanners. Deliberately a small state machine rather than a regex: regex
 * cannot tell a `//` inside a string from a comment, and a false positive here
 * would block a legitimate commit.
 *
 * @param {string} src
 * @returns {string} source with comments and literal bodies blanked, offsets preserved
 */
export function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += quote; i++;
      while (i < n) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (src[i] === quote) { out += quote; i++; break; }
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Extract every module specifier a source file imports, static or dynamic.
 *
 * @param {string} scrubbed - source already passed through stripCommentsAndStrings
 * @param {string} original - the raw source, used to recover specifier text
 * @returns {{ spec: string, line: number }[]}
 */
export function extractImports(scrubbed, original) {
  const found = [];
  // Specifiers live inside string literals, which the scrubber blanked. So match
  // positions on the scrubbed source (to skip commented-out imports) and read
  // the specifier back out of the original at the same offset.
  const patterns = [
    /\bimport\s+[^;]*?\bfrom\s*['"`]/g,
    /\bimport\s*['"`]/g,
    /\bimport\s*\(\s*['"`]/g,
    /\brequire\s*\(\s*['"`]/g,
    /\bexport\s+[^;]*?\bfrom\s*['"`]/g,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(scrubbed)) !== null) {
      const start = m.index + m[0].length;
      const quote = original[start - 1];
      let end = start;
      while (end < original.length && original[end] !== quote) end++;
      const spec = original.slice(start, end);
      if (spec) found.push({ spec, line: original.slice(0, start).split('\n').length });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/** @param {string} dir @returns {string[]} */
function collectModules(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectModules(full));
    else if (extname(entry.name) === '.mjs' && !entry.name.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

/**
 * Audit one module.
 *
 * @param {string} file - absolute path
 * @param {string} source
 * @returns {{ file: string, line: number, kind: string, detail: string, fix: string }[]}
 */
export function auditModule(file, source) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const scrubbed = stripCommentsAndStrings(source);
  /** @type {{ file: string, line: number, kind: string, detail: string, fix: string }[]} */
  const violations = [];

  for (const { spec, line } of extractImports(scrubbed, source)) {
    if (spec.startsWith('.')) continue; // relative — stays inside core/, checked below
    if (BUILTINS.has(spec) || BUILTINS.has(spec.replace(/^node:/, ''))) {
      violations.push({
        file: rel, line, kind: 'builtin-import', detail: spec,
        fix: 'move this I/O to an adapter behind a port; core/ takes the data as an argument',
      });
    } else {
      violations.push({
        file: rel, line, kind: 'package-import', detail: spec,
        fix: 'the domain core has no third-party dependencies; parse in an adapter and pass a domain object in',
      });
    }
  }

  // A relative import that climbs out of core/ is an escape hatch around the above.
  for (const { spec, line } of extractImports(scrubbed, source)) {
    if (!spec.startsWith('.')) continue;
    const resolved = relative(CORE_DIR, join(file, '..', spec)).split('\\').join('/');
    if (resolved.startsWith('..')) {
      violations.push({
        file: rel, line, kind: 'escapes-core', detail: spec,
        fix: 'core/ may only import from core/',
      });
    }
  }

  const lines = scrubbed.split('\n');
  for (const { re, what, fix } of NONDETERMINISM) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        violations.push({ file: rel, line: i + 1, kind: 'non-determinism', detail: what, fix });
      }
    }
  }

  return violations;
}

function main() {
  const dirArg = process.argv.indexOf('--dir');
  const target = dirArg !== -1 && process.argv[dirArg + 1] ? join(ROOT, process.argv[dirArg + 1]) : CORE_DIR;
  const asJson = process.argv.includes('--json');

  const modules = collectModules(target);
  const violations = modules.flatMap((f) => auditModule(f, readFileSync(f, 'utf8')));

  if (asJson) {
    console.log(JSON.stringify({ scanned: modules.length, violations }, null, 2));
    process.exit(violations.length === 0 ? 0 : 1);
  }

  if (modules.length === 0) {
    console.log('core purity: no modules found — nothing to check');
    process.exit(0);
  }

  if (violations.length === 0) {
    console.log(`core purity: ${modules.length} module(s) clean — no I/O, no packages, no non-determinism`);
    process.exit(0);
  }

  console.error(`core purity: ${violations.length} violation(s) across ${modules.length} module(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.kind}]  ${v.detail}`);
    console.error(`      → ${v.fix}`);
  }
  console.error('\nThe domain core must stay deterministic: reproducible scoring depends on it.');
  process.exit(1);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
