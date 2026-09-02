// tests/generate-pdf-fact-gate.test.mjs — B7-D1: generate-pdf.mjs must run the
// CV fact gate (verify-cv-facts.mjs's assertFacts) before rendering, the same
// way generate-cover-letter.mjs already does. Same sandboxed-CLI + stub-
// playwright harness as tests/generate-pdf-page-budget.test.mjs: a real
// subprocess run of the actual script, with Playwright replaced by a stub
// that returns a hand-built PDF buffer instead of launching a browser.
//
// Confirmed live (docs/DEFECT-HUNT-LEDGER.md B7-D1): before this fix, a
// generated CV HTML containing a fabricated metric ("Increased revenue by
// 500%", absent from cv.md) rendered to a PDF successfully with no fact
// check at all, despite this module's own header comment claiming the gate
// was "shared by PDF generators". This test locks the wiring in place.
import { spawnSync } from 'child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync,
} from 'fs';
import { join } from 'path';
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { buildFixturePdf } from './fixtures/pdf-fixtures.mjs';

const outputRoot = join(ROOT, 'output');
mkdirSync(outputRoot, { recursive: true });
const sandbox = mkdtempSync(join(outputRoot, 'fact-gate-test-'));
const script = join(sandbox, 'generate-pdf.mjs');
const manifest = join(sandbox, 'data', 'pdf-index.tsv');
mkdirSync(join(sandbox, 'data'), { recursive: true });
writeFileSync(manifest, '', 'utf-8');
const playwrightStub = join(sandbox, 'node_modules', 'playwright');

copyFileSync(join(ROOT, 'generate-pdf.mjs'), script);
copyFileSync(join(ROOT, 'theme-style.mjs'), join(sandbox, 'theme-style.mjs'));
copyFileSync(join(ROOT, 'verify-cv-facts.mjs'), join(sandbox, 'verify-cv-facts.mjs'));
mkdirSync(join(sandbox, 'lib'), { recursive: true });
copyFileSync(join(ROOT, 'lib', 'pdf-text.mjs'), join(sandbox, 'lib', 'pdf-text.mjs'));
mkdirSync(playwrightStub, { recursive: true });
writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({
  name: 'playwright', type: 'module', exports: './index.js',
}), 'utf-8');

const fixturePdfB64 = buildFixturePdf({ lines: ['Jane Doe'] }).toString('base64');
writeFileSync(join(playwrightStub, 'index.js'), `
const pdf = Buffer.from('${fixturePdfB64}', 'base64');
export const chromium = {
  async launch() {
    return {
      async newPage() {
        return { async goto() {}, async evaluate() {}, async pdf() { return pdf; } };
      },
      async close() {},
    };
  },
};
`, 'utf-8');

// This sandbox's own cv.md — the source assertFacts checks the generated CV
// against. Only "Senior Engineer" / "Acme Corp" are truthful here.
writeFileSync(join(sandbox, 'cv.md'), `# Jane Doe

## Experience

Senior Engineer at Acme Corp, 2020-2024.
`, 'utf-8');

const truthfulInput = join(sandbox, 'truthful.html');
writeFileSync(truthfulInput, `<!doctype html><html><body>
<main>Senior Engineer at Acme Corp, 2020-2024.</main>
</body></html>`, 'utf-8');

const fabricatedInput = join(sandbox, 'fabricated.html');
writeFileSync(fabricatedInput, `<!doctype html><html><body>
<main>Increased company-wide revenue by 500% at Acme Corp.</main>
</body></html>`, 'utf-8');

function runPdf(args) {
  const result = spawnSync(NODE, [script, ...args], { cwd: sandbox, encoding: 'utf-8', timeout: 30_000 });
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
}

try {
  const fabricatedOut = join(sandbox, 'fabricated.pdf');
  const blocked = runPdf([fabricatedInput, fabricatedOut]);
  if (blocked.status !== 0 && /Fact check failed for CV/.test(blocked.output) && !existsSync(fabricatedOut)) {
    pass('generate-pdf blocks a fabricated metric absent from cv.md and writes no PDF');
  } else {
    fail(`generate-pdf did not block the fabricated CV: status=${blocked.status}, output=${blocked.output.trim()}`);
  }

  const truthfulOut = join(sandbox, 'truthful.pdf');
  const allowed = runPdf([truthfulInput, truthfulOut]);
  if (allowed.status === 0 && existsSync(truthfulOut)) {
    pass('generate-pdf renders a CV whose claims are all backed by cv.md');
  } else {
    fail(`generate-pdf wrongly blocked a truthful CV: status=${allowed.status}, output=${allowed.output.trim()}`);
  }
} catch (e) {
  fail(`generate-pdf fact-gate tests crashed: ${e.message}`);
}
