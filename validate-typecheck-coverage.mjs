#!/usr/bin/env node

/**
 * validate-typecheck-coverage.mjs — ratchet guard for @ts-check adoption.
 *
 * Counts tracked .mjs/.js files carrying `// @ts-check` and fails if the
 * count drops below the committed floor in .typecheck-floor. New files may
 * land unchecked; the total may never regress. Mirrors
 * validate-system-paths-coverage.mjs in both structure and spirit.
 *
 * Raise the floor: node validate-typecheck-coverage.mjs --bless
 * Run:            node validate-typecheck-coverage.mjs
 * Self-test:      node validate-typecheck-coverage.mjs --self-test
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FLOOR_PATH = join(ROOT, '.typecheck-floor');

// Trees that live in the repo but are deliberately outside the tsconfig.json
// `include` globs (web/ isolation contract, generated/vendored dirs).
const EXCLUDE_PREFIXES = ['web/', 'dashboard/', 'batch/', 'output/', 'test-fixtures/', 'node_modules/'];

/**
 * True when the file's first non-blank line is (or contains) the
 * `// @ts-check` pragma — the same convention TypeScript itself checks for.
 *
 * @param {string} content - Full file contents.
 * @returns {boolean}
 */
export function hasTsCheckPragma(content) {
  return /^\s*\/\/\s*@ts-check\b/m.test(content);
}

/**
 * @param {string} file - Repo-relative path.
 * @returns {boolean}
 */
function inScope(file) {
  if (!/\.(mjs|js)$/.test(file)) return false;
  return !EXCLUDE_PREFIXES.some((p) => file.startsWith(p));
}

if (process.argv.includes('--self-test')) {
  console.log('Running validate-typecheck-coverage.mjs self-tests...');

  const assert = (condition, message) => {
    if (!condition) {
      console.error(`FAIL: ${message}`);
      process.exit(1);
    }
  };

  assert(hasTsCheckPragma('// @ts-check\nconst x = 1;') === true, 'leading pragma must be detected');
  assert(hasTsCheckPragma('#!/usr/bin/env node\n// @ts-check\nconst x = 1;') === true, 'pragma after a shebang must be detected');
  assert(hasTsCheckPragma('  // @ts-check') === true, 'indented pragma must be detected');
  assert(hasTsCheckPragma('const x = 1; // @ts-check') === false, 'trailing-comment pragma (not line-leading) must NOT count');
  assert(hasTsCheckPragma('// this mentions @ts-check in prose') === false, 'prose mention must NOT count as the pragma');
  assert(hasTsCheckPragma('const x = 1;') === false, 'a file with no pragma must NOT count');

  assert(inScope('scan.mjs') === true, 'root .mjs must be in scope');
  assert(inScope('providers/greenhouse.mjs') === true, 'providers/*.mjs must be in scope');
  assert(inScope('web/src/App.jsx') === false, 'web/ must be excluded (isolation contract)');
  assert(inScope('dashboard/main.go') === false, 'dashboard/ non-.mjs must be excluded');
  assert(inScope('templates/cv-template.html') === false, 'non-.mjs/.js files must be excluded');

  console.log('ALL SELF-TESTS PASSED');
  process.exit(0);
}

let tracked;
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
} catch (err) {
  console.error('FAIL: git ls-files failed:', err.message);
  process.exit(1);
}

if (tracked.length === 0) {
  console.error('FAIL: git ls-files returned no paths — this run could not inspect anything.');
  console.error('Run this from the repository root, not a throwaway/untracked copy.');
  process.exit(1);
}

let count = 0;
for (const file of tracked) {
  if (!inScope(file)) continue;
  const full = join(ROOT, file);
  if (!existsSync(full)) continue; // tracked but not present locally (e.g. sparse checkout)
  let content;
  try {
    content = readFileSync(full, 'utf-8');
  } catch {
    continue;
  }
  if (hasTsCheckPragma(content)) count++;
}

if (process.argv.includes('--bless')) {
  writeFileSync(FLOOR_PATH, `${count}\n`);
  console.log(`Blessed: floor raised to ${count}`);
  process.exit(0);
}

if (!existsSync(FLOOR_PATH)) {
  console.error(`FAIL: ${FLOOR_PATH} not found. Run with --bless to create it.`);
  process.exit(1);
}

const floor = parseInt(readFileSync(FLOOR_PATH, 'utf-8').trim(), 10);
if (!Number.isFinite(floor)) {
  console.error(`FAIL: .typecheck-floor does not contain a valid integer`);
  process.exit(1);
}

if (count < floor) {
  console.error(`FAIL: @ts-check coverage regressed — ${count} files carry the pragma, floor is ${floor}.`);
  console.error('A file that had `// @ts-check` lost it, or the floor is stale. If this drop is intentional,');
  console.error('re-run with --bless after confirming the regression is expected.');
  process.exit(1);
}

console.log(`OK: ${count} tracked files carry // @ts-check (floor: ${floor})`);
process.exit(0);
