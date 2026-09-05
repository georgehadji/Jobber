// tests/data-contract-guards.test.mjs — two guards in test-all.mjs §5 (Data
// Contract) reported the user's private files as safe while verifying nothing
// (defect-hunt batch 18, B18-D1/D2).
//
// Both protect the user layer — cv.md, config/profile.yml, modes/_profile.md,
// portals.yml — which AGENTS.md defines as never-committed personal data.
//
// B18-D1: `git ls-files <path>` has three outcomes and only two are answers —
//   empty output = untracked, the path back = tracked, non-zero exit = the
//   lookup could not run. run() collapses the third to null, and the loop
//   mapped null to pass('User file gitignored'). Wherever git is absent or the
//   tree is not a work tree, the suite asserted the user's CV config was safe
//   having checked nothing.
// B18-D2: the .gitignore negation guard is driven entirely by USER_PATHS. An
//   empty list makes suspiciousNegations unreachable, so the assertion passes
//   unconditionally. extractArrayFromSource returns [] for a constant it cannot
//   find, so renaming USER_PATHS would silently disable the guard.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, run, ROOT } from './helpers.mjs';
import { extractArrayFromSource } from '../update-system.mjs';

console.log('\ntest-all.mjs §5 — data-contract guards cannot report safe without checking (B18)');

// ── B18-D1, behavioural: the three outcomes are distinct ─────────
const untracked = run('git', ['ls-files', 'config/profile.yml']);
const tracked = run('git', ['ls-files', 'package.json']);
// A pathspec git rejects: non-zero exit, the same shape as "not a git
// repository" or git missing from PATH.
const broken = run('git', ['ls-files', ':(bogusmagic)config/profile.yml'], { stdio: ['pipe', 'pipe', 'ignore'] });

if (untracked === '') pass('git ls-files returns empty for an untracked user file — the genuine "gitignored" signal');
else fail(`expected '' for an untracked user file, got ${JSON.stringify(untracked)}`);

if (typeof tracked === 'string' && tracked.length > 0) pass('git ls-files returns the path for a tracked file — the genuine "tracked" signal');
else fail(`expected a path for a tracked file, got ${JSON.stringify(tracked)}`);

if (broken === null) pass('a lookup that could not run returns null — distinct from the empty-string "untracked" answer');
else fail(`expected null for an unrunnable lookup, got ${JSON.stringify(broken)} — if run()'s contract changed, §5's null branch needs revisiting`);

// ── B18-D2, behavioural: an empty USER_PATHS disables the guard ──
// Replays §5's negation loop over two deliberate leaks, once with the real
// USER_PATHS and once with the empty list extractArrayFromSource returns for a
// missing constant. The second must not silently find nothing.
const updateSystemSource = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
const realUserPaths = extractArrayFromSource(updateSystemSource, 'USER_PATHS');
const missingConst = extractArrayFromSource(updateSystemSource, 'USER_PATHS_THAT_DOES_NOT_EXIST');

const countLeaks = (userPaths) => {
  const found = [];
  for (const raw of ['!config/profile.yml', '!cv.md']) {
    const line = raw.trim();
    const pattern = line.slice(1).trim();
    if (/(?:\/|^)(?:\.gitkeep|README\.md)$/i.test(pattern) || pattern.endsWith('/')) continue;
    const normalized = pattern.replace(/^\.?\//, '');
    if (userPaths.some((p) => normalized === p || normalized.startsWith(p))) found.push(line);
  }
  return found.length;
};

if (realUserPaths.length > 0) pass(`USER_PATHS parses to ${realUserPaths.length} entries — the negation guard has something to check against`);
else fail('USER_PATHS parsed to an empty list — the .gitignore negation guard in §5 is a no-op');

if (countLeaks(realUserPaths) === 2) pass('with the real USER_PATHS, the negation logic catches both deliberate leaks');
else fail(`the negation logic missed a deliberate leak (caught ${countLeaks(realUserPaths)} of 2)`);

if (Array.isArray(missingConst) && missingConst.length === 0) {
  pass('extractArrayFromSource returns [] for a missing constant — it fails silently, which is why §5 must check the length');
} else {
  fail(`extractArrayFromSource no longer returns [] for a missing constant (got ${JSON.stringify(missingConst)}) — §5's length check may need revisiting`);
}
if (countLeaks(missingConst) === 0) {
  pass('an empty USER_PATHS catches 0 of 2 leaks — confirming the guard is vacuous without the length check');
} else {
  fail('an empty USER_PATHS unexpectedly caught a leak; this record needs updating');
}

// ── source: §5 draws both distinctions ───────────────────────────
// Presence checks only — the corrected code quotes the old behaviour in its
// comments (the constraint recorded in batches 11/12/14/15/17).
const src = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8');
const section = src.slice(src.indexOf('Check user files are NOT tracked'), src.indexOf('6. PERSONAL DATA LEAK CHECK'));

if (/lookup failed — not evidence of absence/.test(section)) {
  pass('§5 treats an unrunnable git ls-files as a failure, not as proof the file is gitignored');
} else {
  fail('§5 maps a failed lookup back to a pass — the user-file gitignore check reports safe without checking (B18-D1)');
}
if (/userPaths\.length === 0/.test(section)) {
  pass('§5 refuses to run the negation guard against an empty USER_PATHS');
} else {
  fail('§5 no longer checks that USER_PATHS parsed — an empty list makes the negation guard pass unconditionally (B18-D2)');
}
