// tests/generate-pdf-text-layer.test.mjs — generate-pdf.mjs's --dump-text /
// --strict-text wiring around lib/pdf-text.mjs. Same sandboxed-CLI + stub-
// playwright harness as tests/generate-pdf-page-budget.test.mjs: a real
// subprocess run of the actual script, with Playwright replaced by a stub
// that returns a hand-built PDF buffer instead of launching a browser.
import { spawnSync } from 'child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync,
} from 'fs';
import { join, relative } from 'path';
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { buildFixturePdf } from './fixtures/pdf-fixtures.mjs';

const outputRoot = join(ROOT, 'output');
mkdirSync(outputRoot, { recursive: true });
const sandbox = mkdtempSync(join(outputRoot, 'text-layer-test-'));
const script = join(sandbox, 'generate-pdf.mjs');
const cleanInput = join(sandbox, 'clean.html');
const brokenInput = join(sandbox, 'broken.html');
const manifest = join(sandbox, 'data', 'pdf-index.tsv');
mkdirSync(join(sandbox, 'data'), { recursive: true });
writeFileSync(manifest, '', 'utf-8');
const playwrightStub = join(sandbox, 'node_modules', 'playwright');

copyFileSync(join(ROOT, 'generate-pdf.mjs'), script);
copyFileSync(join(ROOT, 'theme-style.mjs'), join(sandbox, 'theme-style.mjs'));
mkdirSync(join(sandbox, 'lib'), { recursive: true });
copyFileSync(join(ROOT, 'lib', 'pdf-text.mjs'), join(sandbox, 'lib', 'pdf-text.mjs'));
mkdirSync(playwrightStub, { recursive: true });
writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({
  name: 'playwright', type: 'module', exports: './index.js',
}), 'utf-8');

const cleanPdfB64 = buildFixturePdf({ lines: ['Jane Doe', 'jane.doe@example.com'] }).toString('base64');
const brokenPdfB64 = buildFixturePdf({ withToUnicode: false, lines: ['Jane Doe'] }).toString('base64');

writeFileSync(join(playwrightStub, 'index.js'), `
import { readFile } from 'fs/promises';

const cleanPdf = Buffer.from('${cleanPdfB64}', 'base64');
const brokenPdf = Buffer.from('${brokenPdfB64}', 'base64');

export const chromium = {
  async launch() {
    let renderedPdf = cleanPdf;
    return {
      async newPage() {
        return {
          async goto(url) {
            const html = await readFile(new URL(url), 'utf-8');
            renderedPdf = html.includes('BROKEN_FIXTURE') ? brokenPdf : cleanPdf;
          },
          async evaluate() {},
          async pdf() { return renderedPdf; },
        };
      },
      async close() {},
    };
  },
};
`, 'utf-8');

writeFileSync(cleanInput, '<!doctype html><html><body><p>clean fixture</p></body></html>\n', 'utf-8');
writeFileSync(brokenInput, '<!doctype html><html><body><p>BROKEN_FIXTURE</p></body></html>\n', 'utf-8');

function runPdf(args) {
  const result = spawnSync(NODE, [script, ...args], { cwd: sandbox, encoding: 'utf-8', timeout: 30_000 });
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function manifestHasPdf(path) {
  const expected = relative(sandbox, path).replaceAll('\\', '/');
  return readFileSync(manifest, 'utf-8').split('\n').some((line) => line.split('\t')[1] === expected);
}

try {
  // 1. --dump-text writes the extraction, and generation succeeds by default
  //    on a clean text layer.
  const cleanOut = join(sandbox, 'clean.pdf');
  const cleanDump = join(sandbox, 'clean.txt');
  const clean = runPdf([cleanInput, cleanOut, `--dump-text=${cleanDump}`]);
  if (
    clean.status === 0 &&
    existsSync(cleanOut) &&
    existsSync(cleanDump) &&
    readFileSync(cleanDump, 'utf-8').includes('jane.doe@example.com') &&
    manifestHasPdf(cleanOut) &&
    clean.output.includes('Text layer dumped')
  ) {
    pass('--dump-text writes the extracted text layer and generation succeeds');
  } else {
    fail(`--dump-text on a clean fixture regressed: ${clean.output.trim()}`);
  }

  // 2. A broken text layer (no ToUnicode) warns by default but still
  //    publishes the PDF and updates the manifest — same warn-only shape as
  //    page-budget overflow.
  const brokenDefaultOut = join(sandbox, 'broken-default.pdf');
  const brokenDefault = runPdf([brokenInput, brokenDefaultOut]);
  if (
    brokenDefault.status === 0 &&
    existsSync(brokenDefaultOut) &&
    manifestHasPdf(brokenDefaultOut) &&
    brokenDefault.output.includes('CID_PLACEHOLDER') &&
    brokenDefault.output.includes('ATS-readability findings')
  ) {
    pass('a broken text layer warns loudly by default but still publishes the PDF');
  } else {
    fail(`default-mode broken-text-layer handling regressed: ${brokenDefault.output.trim()}`);
  }

  // 3. --strict-text rejects a broken text layer: non-zero exit, PDF written
  //    for inspection, manifest NOT updated — mirrors --strict-pages exactly.
  const brokenStrictOut = join(sandbox, 'broken-strict.pdf');
  const brokenStrict = runPdf([brokenInput, brokenStrictOut, '--strict-text']);
  if (
    brokenStrict.status !== 0 &&
    existsSync(brokenStrictOut) &&
    !manifestHasPdf(brokenStrictOut) &&
    brokenStrict.output.includes('CID_PLACEHOLDER') &&
    brokenStrict.output.includes('--strict-text requested') &&
    !brokenStrict.output.includes('✅ PDF generated')
  ) {
    pass('--strict-text rejects a broken text layer without publishing it');
  } else {
    fail(`--strict-text did not reject a broken text layer: ${brokenStrict.output.trim()}`);
  }

  // 4. --strict-text on a clean text layer is a no-op: still succeeds.
  const cleanStrictOut = join(sandbox, 'clean-strict.pdf');
  const cleanStrict = runPdf([cleanInput, cleanStrictOut, '--strict-text']);
  if (cleanStrict.status === 0 && existsSync(cleanStrictOut) && manifestHasPdf(cleanStrictOut)) {
    pass('--strict-text is a no-op on a clean text layer');
  } else {
    fail(`--strict-text wrongly rejected a clean text layer: ${cleanStrict.output.trim()}`);
  }

  // 5. Path-traversal guard on --dump-text: refused before any rendering.
  const traversalOut = join(sandbox, 'traversal.pdf');
  const traversal = runPdf([cleanInput, traversalOut, '--dump-text=../../etc/passwd']);
  if (
    traversal.status !== 0 &&
    traversal.output.includes('Refusing to write --dump-text outside the project directory') &&
    !existsSync(traversalOut)
  ) {
    pass('--dump-text refuses a path outside the project directory');
  } else {
    fail(`--dump-text path-traversal guard regressed: ${traversal.output.trim()}`);
  }
} catch (e) {
  fail(`generate-pdf-text-layer tests crashed: ${e.message}`);
}
