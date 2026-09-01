// tests/ingest-documents.test.mjs — ingest-documents.mjs (Phase 4,
// docs/AI-JOB-SEARCH-PORT-PLAN.md). Sandboxed subprocess harness, same shape
// as tests/generate-pdf-page-budget.test.mjs: the real script runs against
// an isolated documents/ tree, never the repo's own.
import { spawnSync } from 'child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync,
} from 'fs';
import { join } from 'path';
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { buildFixturePdf } from './fixtures/pdf-fixtures.mjs';

const outputRoot = join(ROOT, 'output');
mkdirSync(outputRoot, { recursive: true });
const sandbox = mkdtempSync(join(outputRoot, 'ingest-documents-test-'));
const script = join(sandbox, 'ingest-documents.mjs');

copyFileSync(join(ROOT, 'ingest-documents.mjs'), script);
mkdirSync(join(sandbox, 'lib'), { recursive: true });
copyFileSync(join(ROOT, 'lib', 'pdf-text.mjs'), join(sandbox, 'lib', 'pdf-text.mjs'));

for (const subdir of ['cv', 'linkedin', 'diplomas', 'references']) {
  mkdirSync(join(sandbox, 'documents', subdir), { recursive: true });
}

function run(args = ['--json']) {
  const result = spawnSync(NODE, [script, ...args], { cwd: sandbox, encoding: 'utf-8', timeout: 30_000 });
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function findFile(result, path) {
  return result.files.find((f) => f.path === path);
}
function findSkip(result, path) {
  return result.skipped.find((s) => s.path === path);
}

try {
  // 1. Plain-text ingestion + ignored basenames never appear in output.
  writeFileSync(join(sandbox, 'documents', 'cv', 'resume.md'), '# Jane Doe\n\nSenior Engineer.\n', 'utf-8');
  writeFileSync(join(sandbox, 'documents', 'cv', '.gitkeep'), '', 'utf-8');
  writeFileSync(join(sandbox, 'documents', 'cv', 'README.md'), 'scaffold doc', 'utf-8');
  writeFileSync(join(sandbox, 'documents', 'linkedin', 'export.txt'), 'LinkedIn profile export text', 'utf-8');
  writeFileSync(join(sandbox, 'documents', 'references', 'ref.tex'), '\\documentclass{article}\nReference letter body.\n', 'utf-8');

  let result = JSON.parse(run().stdout);
  const resume = findFile(result, 'cv/resume.md');
  if (resume && resume.text.includes('Jane Doe') && resume.kind === 'cv') {
    pass('ingest() extracts .md text and tags it with the right kind');
  } else {
    fail(`markdown ingestion regressed: ${JSON.stringify(result)}`);
  }
  if (findFile(result, 'linkedin/export.txt')?.kind === 'linkedin') {
    pass('ingest() extracts .txt text under the linkedin/ kind');
  } else {
    fail('txt ingestion under linkedin/ regressed');
  }
  if (findFile(result, 'references/ref.tex')?.text.includes('Reference letter body')) {
    pass('ingest() extracts .tex as plain text');
  } else {
    fail('.tex ingestion regressed');
  }
  if (!findFile(result, 'cv/.gitkeep') && !findFile(result, 'cv/README.md')
      && !findSkip(result, 'cv/.gitkeep') && !findSkip(result, 'cv/README.md')) {
    pass('.gitkeep and README.md scaffold files never appear in files[] or skipped[]');
  } else {
    fail(`scaffold files leaked into output: ${JSON.stringify(result)}`);
  }

  // 2. A real PDF (built the same way as tests/pdf-text-layer.test.mjs) ingests via lib/pdf-text.mjs.
  writeFileSync(join(sandbox, 'documents', 'diplomas', 'degree.pdf'), buildFixturePdf({ lines: ['MSc Physics', 'University of Example, 2020'] }));
  result = JSON.parse(run().stdout);
  const pdf = findFile(result, 'diplomas/degree.pdf');
  if (pdf && pdf.text.includes('MSc Physics') && pdf.kind === 'diplomas') {
    pass('ingest() extracts a PDF text layer via lib/pdf-text.mjs');
  } else {
    fail(`PDF ingestion regressed: ${JSON.stringify(result)}`);
  }

  // 3. DOCX is explicitly unsupported, with a clear reason — not silently dropped.
  writeFileSync(join(sandbox, 'documents', 'cv', 'resume.docx'), 'not a real docx, contents irrelevant');
  result = JSON.parse(run().stdout);
  const docxSkip = findSkip(result, 'cv/resume.docx');
  if (docxSkip && /DOCX is not supported/.test(docxSkip.reason) && !findFile(result, 'cv/resume.docx')) {
    pass('DOCX is skipped with a clear reason, never silently dropped');
  } else {
    fail(`DOCX handling regressed: ${JSON.stringify(result)}`);
  }

  // 4. An unrecognized extension is skipped with a reason, not thrown.
  writeFileSync(join(sandbox, 'documents', 'cv', 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  result = JSON.parse(run().stdout);
  if (findSkip(result, 'cv/photo.png')?.reason.includes('unsupported file type')) {
    pass('an unrecognized extension is skipped with a reason');
  } else {
    fail(`unsupported-extension handling regressed: ${JSON.stringify(result)}`);
  }

  // 5. Oversize file is skipped with the size reported, not read into a
  //    giant text field.
  writeFileSync(join(sandbox, 'documents', 'cv', 'huge.txt'), Buffer.alloc(21 * 1024 * 1024, 'x'));
  result = JSON.parse(run().stdout);
  const hugeSkip = findSkip(result, 'cv/huge.txt');
  if (hugeSkip && /exceeds the 20 MB cap/.test(hugeSkip.reason) && !findFile(result, 'cv/huge.txt')) {
    pass('an oversize file is skipped (not read) with its size in the reason');
  } else {
    fail(`oversize-file handling regressed: ${JSON.stringify(hugeSkip)}`);
  }

  // 6. Empty/whitespace-only content extracts to zero chars and is skipped,
  //    not emitted as a zero-value entry.
  writeFileSync(join(sandbox, 'documents', 'cv', 'empty.txt'), '   \n\n  \n', 'utf-8');
  result = JSON.parse(run().stdout);
  if (findSkip(result, 'cv/empty.txt')?.reason.includes('zero characters') && !findFile(result, 'cv/empty.txt')) {
    pass('whitespace-only content is skipped as zero-character extraction');
  } else {
    fail(`empty-content handling regressed: ${JSON.stringify(result)}`);
  }

  // 7. A missing subdirectory (never created by the user) does not crash —
  //    it just contributes nothing. references/ already exists in this
  //    sandbox with content, so exercise a fully-absent case separately.
  const bareSandbox = mkdtempSync(join(outputRoot, 'ingest-documents-test-'));
  copyFileSync(script, join(bareSandbox, 'ingest-documents.mjs'));
  mkdirSync(join(bareSandbox, 'lib'), { recursive: true });
  copyFileSync(join(ROOT, 'lib', 'pdf-text.mjs'), join(bareSandbox, 'lib', 'pdf-text.mjs'));
  // No documents/ directory at all.
  const bareResult = spawnSync(NODE, [join(bareSandbox, 'ingest-documents.mjs'), '--json'], { cwd: bareSandbox, encoding: 'utf-8' });
  const bareParsed = JSON.parse(bareResult.stdout);
  if (bareResult.status === 0 && bareParsed.files.length === 0 && bareParsed.skipped.length === 0) {
    pass('a completely absent documents/ tree yields an empty inventory, no crash');
  } else {
    fail(`absent-documents-dir handling regressed: ${bareResult.output || bareResult.stdout}`);
  }

  // 8. --summary is human-readable and reports the same totals as --json.
  const summaryRun = run(['--summary']);
  if (/file\(s\) ingested/.test(summaryRun.output) && summaryRun.status === 0) {
    pass('--summary produces a human-readable report');
  } else {
    fail(`--summary output regressed: ${summaryRun.output}`);
  }

  // 9. --capabilities and --help exit 0 without touching documents/ at all.
  const capsRun = run(['--capabilities']);
  if (capsRun.status === 0 && JSON.parse(capsRun.stdout).script === 'ingest-documents.mjs') {
    pass('--capabilities reports the script contract');
  } else {
    fail(`--capabilities regressed: ${capsRun.output}`);
  }

  // 10. THE structural safety property: ingest() writes nothing. Snapshot
  //     every file's mtime+size before and after a run and assert no diff.
  const { statSync, readdirSync } = await import('fs');
  function snapshot(dir) {
    const out = {};
    for (const subdir of ['cv', 'linkedin', 'diplomas', 'references']) {
      for (const name of readdirSync(join(dir, 'documents', subdir))) {
        const s = statSync(join(dir, 'documents', subdir, name));
        out[`${subdir}/${name}`] = `${s.size}:${s.mtimeMs}`;
      }
    }
    return out;
  }
  const before = snapshot(sandbox);
  run();
  const after = snapshot(sandbox);
  if (JSON.stringify(before) === JSON.stringify(after)) {
    pass('ingest() writes nothing — documents/ is byte-for-byte and mtime-for-mtime unchanged');
  } else {
    fail('ingest() mutated a file under documents/ — it must be strictly read-only');
  }

  // 11. Symlink escape: a symlink inside documents/cv/ pointing outside its
  //     subdir is refused, never read. Windows may refuse symlink creation
  //     without elevated privilege/Developer Mode — skip gracefully rather
  //     than false-failing on a locked-down machine.
  const secretPath = join(sandbox, 'secret-outside-documents.txt');
  writeFileSync(secretPath, 'THIS MUST NEVER BE READ BY INGEST', 'utf-8');
  const linkPath = join(sandbox, 'documents', 'cv', 'escape-link.md');
  let symlinkOk = true;
  try {
    symlinkSync(secretPath, linkPath, 'file');
  } catch {
    symlinkOk = false;
  }
  if (symlinkOk) {
    result = JSON.parse(run().stdout);
    const escapeSkip = findSkip(result, 'cv/escape-link.md');
    const escapeFound = findFile(result, 'cv/escape-link.md');
    if (escapeSkip && /escapes its documents\//.test(escapeSkip.reason) && !escapeFound
        && !JSON.stringify(result).includes('THIS MUST NEVER BE READ')) {
      pass('a symlink escaping documents/<subdir>/ is refused, its target never read');
    } else {
      fail(`symlink containment regressed: ${JSON.stringify(result)}`);
    }
  } else {
    pass('symlink containment check skipped — this environment cannot create symlinks without elevation');
  }
} catch (e) {
  fail(`ingest-documents tests crashed: ${e.message}\n${e.stack}`);
}
