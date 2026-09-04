// tests/application-artifacts.test.mjs — application-artifacts.mjs bundle paths,
// directory initialization, reuse decisions, and CLI validation.
//
// Uses pass()/fail() from tests/helpers.mjs like every other discovered suite.
// It previously printed its own "✅" lines with console.log and signalled
// failure by throwing, which left it invisible to the shared counters: the
// canonical run (test-all.mjs) and test-runner's serial mode both attributed
// it 0 passed despite 10 real assertions, while test-runner's --parallel mode
// scraped the printed markers and reported 10 — the only file out of 148 whose
// count depended on which runner you used (defect-hunt batch 12, B12-D1).
// Failures were always caught, on all three paths, so nothing was ever hidden;
// only the pass total disagreed.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';
import { applicationArtifactPaths, ensureApplicationArtifactDirs, slugifySegment, writeReuseDecision } from '../application-artifacts.mjs';
import { repoRelativeManifestPath } from '../generate-pdf.mjs';

console.log('\napplication-artifacts.mjs — bundle paths, reuse decisions, CLI validation');

function expectError(label, action, pattern) {
  try {
    action();
  } catch (error) {
    if (pattern.test(error.message)) pass(label);
    else fail(`${label}: unexpected error: ${error.message}`);
    return;
  }
  fail(`${label}: expected an error`);
}

const root = mkdtempSync(join(tmpdir(), 'jobber-application-artifacts-'));
try {
  const paths = applicationArtifactPaths({ reportNum: 7, company: 'Acme AI', role: 'Senior AI Engineer', version: 2, root });
  if (paths.key === '007-acme-ai-senior-ai-engineer'
      && paths.cv.source.html === join(paths.root, 'cv', 'source', 'original.html')
      && paths.cv.tailored.pdf === join(paths.root, 'cv', 'tailored', 'v002', 'cv.pdf')) {
    pass('application artifacts use a stable report/company/role bundle');
  } else {
    fail(`unexpected artifact paths: ${JSON.stringify(paths)}`);
  }

  ensureApplicationArtifactDirs(paths);
  if (existsSync(join(paths.root, 'jd'))
      && existsSync(join(paths.root, 'cv', 'source'))
      && existsSync(join(paths.root, 'cv', 'tailored', 'v002'))
      && existsSync(join(paths.root, 'decision'))) {
    pass('application artifact directories initialize together');
  } else {
    fail('application artifact directories were not created');
  }

  writeReuseDecision(paths, {
    decision: 'reuse-with-edits',
    score: 0.81,
    sourceCv: paths.cv.source.html,
    currentJd: paths.jd.current,
    previousSource: paths.jd.previous,
    changedSections: ['Summary', 'Skills'],
  });
  const decision = JSON.parse(readFileSync(paths.decision.reuse, 'utf8'));
  if (decision.decision === 'reuse-with-edits' && decision.changed_sections.length === 2) {
    pass('reuse decisions are recorded beside the artifact bundle');
  } else {
    fail(`unexpected reuse decision: ${JSON.stringify(decision)}`);
  }

  expectError('report numbers must be numeric', () => applicationArtifactPaths({ reportNum: 'x', company: 'Acme', role: 'Engineer', root }), /reportNum must be a numeric report number/);
  expectError('versions must be positive integers', () => applicationArtifactPaths({ reportNum: 7, company: 'Acme', role: 'Engineer', version: 0, root }), /version must be a positive integer/);
  expectError('reuse decisions reject unknown values', () => writeReuseDecision(paths, { decision: 'maybe' }), /decision must be one of/);
  expectError('changed sections must be an array', () => writeReuseDecision(paths, { decision: 'reuse', changedSections: 'Summary' }), /changedSections must be an array/);
  if (slugifySegment('!!!') === 'application') pass('punctuation-only slugs use the application fallback');
  else fail('punctuation-only slug did not use the application fallback');

  const repoPaths = applicationArtifactPaths({ reportNum: 7, company: 'Acme AI', role: 'Senior AI Engineer', version: 2, root: join(process.cwd(), 'output') });
  if (repoRelativeManifestPath(repoPaths.cv.tailored.html) === 'output/007-acme-ai-senior-ai-engineer/cv/tailored/v002/cv.html'
      && repoRelativeManifestPath(repoPaths.cv.tailored.pdf) === 'output/007-acme-ai-senior-ai-engineer/cv/tailored/v002/cv.pdf') {
    pass('nested application HTML and PDF paths remain manifest-safe');
  } else {
    fail('nested application paths were not preserved as repo-relative manifest entries');
  }

  const cli = spawnSync(process.execPath, [
    fileURLToPath(new URL('../application-artifacts.mjs', import.meta.url)),
    '--report', 'bad', '--company', 'Acme', '--role', 'Engineer', '--init',
  ], { encoding: 'utf8' });
  if (cli.status === 1
      && /application-artifacts: reportNum must be a numeric report number/.test(cli.stderr)
      && !/\n\s+at /.test(cli.stderr)) {
    pass('CLI validation failures exit cleanly without a stack trace');
  } else {
    fail(`CLI failure was not clean: status=${cli.status} stderr=${JSON.stringify(cli.stderr)}`);
  }
} catch (e) {
  // Converting the throws above to fail() means the suite keeps going after a
  // failed assertion, so a genuinely unexpected error (a thrown TypeError from
  // cascading state, not an assertion) still has to be reported rather than
  // escaping and aborting the whole canonical run.
  fail(`application-artifacts suite crashed: ${e.message}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
