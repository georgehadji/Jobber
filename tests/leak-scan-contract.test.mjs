// tests/leak-scan-contract.test.mjs — test-all.mjs §6 "Personal data leak
// check" must not report clean when it could not scan, and must clear files by
// exact path rather than by substring (defect-hunt batch 14, B14-D1/D2).
//
// B14-D1: the scan ran each pattern through run(), which returns null on ANY
// failure. `git grep` exits 1 for "no match" and 128 for "not a work tree", so
// both arrived as null, the result loop never executed, and the section
// reported pass('No personal data leaks outside allowed files'). A privacy
// guard that reports success precisely when it did nothing. Reachable wherever
// .git is absent — a tarball or zip install, which is a supported way to get
// this project.
//
// B14-D2: files were cleared with allowedFiles.some(a => file.includes(a)), so
// an entry for a bare basename cleared every path containing it anywhere in the
// tree. Two files were passing the check only through that over-match.
//
// NOTE on the source assertions below: they check for the CORRECTED forms, not
// for the absence of the old ones. The fixed code documents the defect in its
// own comments and therefore still contains the old expressions as prose — an
// absence check would read those comments and fail. Same constraint recorded in
// batches 11 and 12 for source-text guards.
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, ROOT } from './helpers.mjs';

console.log('\ntest-all.mjs §6 — leak scan cannot mistake "could not scan" for "clean" (B14)');

// A string that must not appear anywhere in the tracked tree, used below to
// provoke a genuine no-match. Built by concatenation: written as one literal it
// would appear in THIS file, which git grep scans once the file is tracked, so
// the "no match" probe would match itself and report a hit. That is not
// hypothetical — the first version of this test did exactly that and passed
// locally (the file was still untracked, and git grep only sees tracked files)
// before failing on CI. Same self-reference constraint as the concatenated
// fixtures in test-discovery-guard and counter-parity.
const ABSENT = 'zzz-no-such' + '-string-zzz';

// ── B14-D1, behavioural: the three git-grep outcomes are distinguishable ──
const scratch = mkdtempSync(join(tmpdir(), 'jobber-leak-scan-'));
try {
  writeFileSync(join(scratch, 'a.md'), 'hi\n', 'utf-8');
  // GIT_CEILING_DIRECTORIES stops git walking up into any enclosing repo, so
  // this is a genuine "not a work tree" invocation even when TMPDIR happens to
  // sit inside one — which it does on this machine.
  const outside = spawnSync('git', ['grep', '-n', 'hi', '--', '*.md'], {
    cwd: scratch,
    encoding: 'utf-8',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  if (outside.status !== 0 && outside.status !== 1) {
    pass(`git grep outside a work tree exits ${outside.status} — distinguishable from a clean scan`);
  } else {
    fail(`git grep outside a work tree exited ${outside.status}, which §6 would read as a completed scan`);
  }

  const noMatch = spawnSync('git', ['grep', '-n', ABSENT, '--', '*.mjs'], {
    cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
  });
  if (noMatch.status === 1) pass('git grep with no match exits 1 — the genuine "clean" signal');
  else fail(`git grep with no match exited ${noMatch.status}, expected 1`);

  // The defect itself, pinned: run() erases the distinction the two checks
  // above just established. §6 must not go through it.
  const viaRunClean = run('git', ['grep', '-n', ABSENT, '--', '*.mjs'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const viaRunBroken = run('git', ['grep', '-n', 'hi', '--', ':(bogusmagic)*.md'], { stdio: ['pipe', 'pipe', 'ignore'] });
  if (viaRunClean === null && viaRunBroken === null) {
    pass('run() maps both "no match" and "scan failed" to null — why §6 must read the exit status itself');
  } else {
    fail(`run() no longer collapses these (clean=${viaRunClean}, broken=${viaRunBroken}); revisit whether §6 still needs its own spawnSync`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ── Source assertions on §6 itself ───────────────────────────────
const src = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8');
const section = src.slice(src.indexOf('6. PERSONAL DATA LEAK CHECK'), src.indexOf('7. ABSOLUTE PATH CHECK'));

if (/r\.status !== 0 && r\.status !== 1/.test(section)) {
  pass('§6 classifies the git grep exit status instead of testing truthiness');
} else {
  fail('§6 no longer distinguishes a failed scan from a clean one — it will report "no leaks" having scanned nothing (B14-D1)');
}
if (/\bfail\(`Personal data leak scan could not run/.test(section)) {
  pass('§6 fails loudly when the scan could not run');
} else {
  fail('§6 has no failure path for an unrunnable scan (B14-D1)');
}
if (/allowedFiles\.has\(/.test(section) && /allowedFiles = new Set\(\[/.test(section)) {
  pass('§6 clears files by exact path (Set.has), not by substring');
} else {
  fail('§6 no longer uses exact-path matching — a basename entry will clear every path containing it (B14-D2)');
}

// ── B14-D2, behavioural: exact vs substring on the real allowlist ──
// Both files below contain leak patterns and are legitimate, but were reaching
// the pass only because 'package.json' / 'README.md' are substrings of them.
for (const p of ['scaffolder/package.json', 'scaffolder/README.md']) {
  if (section.includes(`'${p}'`)) pass(`${p} is allowed explicitly, not as a substring accident`);
  else fail(`${p} contains a leak pattern and is no longer listed — it will now warn, or was silently dropped`);
}
