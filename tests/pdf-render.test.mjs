/**
 * pdf-render.test.mjs — generate-pdf.mjs rendering behavior: the Playwright
 * wait condition (load, not networkidle), manifest metadata threading,
 * @page CSS injection, temp-file cleanup on launch/page failure, and the
 * language-aware CV section-order guard (validateCvSectionOrder — Polish
 * headings must be recognized, not just English).
 *
 * Extracted verbatim from test-all.mjs (see tests/README.md — discovered
 * files are auto-run by both test-all.mjs and test-runner.mjs). The two
 * source sections shared a module-level `generatePdfScript` read, kept in
 * one file here for the same reason.
 */

import { readFileSync, mkdtempSync, rmSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { pass, fail, warn, ROOT } from './helpers.mjs';

/**
 * Read a repo-relative text file as UTF-8. Copied verbatim from test-all.mjs
 * (kept local rather than shared, since it's specific to the #1440
 * migration's single-line-symlink-redirect convention for skill entrypoints).
 *
 * @param {string} path - Path relative to the Jobber repository root.
 * @returns {string} File contents.
 */
function readFile(path) {
  const fullPath = join(ROOT, path);
  let content = readFileSync(fullPath, 'utf-8');
  if (content.trim().startsWith('..') && content.trim().split('\n').length === 1) {
    const target = join(dirname(fullPath), content.trim());
    if (existsSync(target)) {
      content = readFileSync(target, 'utf-8');
    }
  }
  return content;
}

console.log('\n7b. PDF render wait condition');

const generatePdfScript = readFile('generate-pdf.mjs');
if (/waitUntil:\s*['"]load['"]/.test(generatePdfScript)) {
  pass('generate-pdf waits for load before rendering');
} else {
  fail('generate-pdf does not wait for load before rendering');
}
if (!/waitUntil:\s*['"]networkidle['"]/.test(generatePdfScript)) {
  pass('generate-pdf does not wait for networkidle');
} else {
  fail('generate-pdf still waits for networkidle');
}

function extractRenderHtmlToPdfOptions(source) {
  const call = /renderHtmlToPdf\s*\(\s*html\s*,\s*outputPath\s*,/g.exec(source);
  if (!call) return '';
  const objectStart = source.indexOf('{', call.index + call[0].length);
  if (objectStart === -1) return '';

  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = objectStart; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(objectStart + 1, i);
    }
  }
  return '';
}

const renderHtmlToPdfOptions = extractRenderHtmlToPdfOptions(generatePdfScript);
if (renderHtmlToPdfOptions && /\breportNum\b/.test(renderHtmlToPdfOptions) && /\binputPath\b/.test(renderHtmlToPdfOptions)) {
  pass('generate-pdf threads reportNum/inputPath into renderHtmlToPdf');
} else {
  fail('generate-pdf does not pass reportNum/inputPath into renderHtmlToPdf');
}
const nestedRenderOptions = extractRenderHtmlToPdfOptions('return renderHtmlToPdf(html, outputPath, { format, metadata: { reportNum, inputPath } });');
if (/\breportNum\b/.test(nestedRenderOptions) && /\binputPath\b/.test(nestedRenderOptions)) {
  pass('generate-pdf renderHtmlToPdf option matcher handles nested object literals');
} else {
  fail('generate-pdf renderHtmlToPdf option matcher fails on nested object literals');
}
if (generatePdfScript.includes('opts.reportNum') && generatePdfScript.includes('opts.inputPath')) {
  pass('renderHtmlToPdf reads manifest metadata from opts');
} else {
  fail('renderHtmlToPdf does not read manifest metadata from opts');
}

if (generatePdfScript.includes('--allow-reorder')) {
  pass('generate-pdf documents --allow-reorder in its usage strings');
} else {
  fail('generate-pdf is missing --allow-reorder from its usage strings');
}

try {
  const { validateCvSectionOrder } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
  const cvMarkdown = '# Education\ntext\n# Work Experience\ntext\n# Projects\ntext';
  const reorderedHtml = '<div class="section-title">Projects</div><div class="section-title">Education</div>';

  let threw = false;
  try {
    validateCvSectionOrder(reorderedHtml, cvMarkdown);
  } catch {
    threw = true;
  }
  if (threw) {
    pass('validateCvSectionOrder throws on a reordered CV by default (--allow-reorder unset)');
  } else {
    fail('validateCvSectionOrder should throw by default when section order diverges from cv.md');
  }

  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  let threwWithFlag = false;
  try {
    validateCvSectionOrder(reorderedHtml, cvMarkdown, { allowReorder: true });
  } catch {
    threwWithFlag = true;
  } finally {
    console.warn = originalWarn;
  }
  if (!threwWithFlag && warned) {
    pass('validateCvSectionOrder({ allowReorder: true }) warns instead of throwing on a reordered CV');
  } else {
    fail('validateCvSectionOrder({ allowReorder: true }) should warn, not throw, and should not silently do neither');
  }
} catch (e) {
  fail(`validateCvSectionOrder allowReorder tests crashed: ${e.message}`);
}
try {
  const { repoRelativeManifestPath, injectPrintPageCss } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
  const insideHtmlPath = join(ROOT, 'templates', 'cv-template.html');
  const outsideHtmlPath = join(dirname(ROOT), 'outside-cv-template.html');

  if (repoRelativeManifestPath(insideHtmlPath) === 'templates/cv-template.html') {
    pass('PDF manifest records repo-local source HTML paths');
  } else {
    fail('PDF manifest does not normalize repo-local source HTML paths');
  }

  if (repoRelativeManifestPath('') === '' && repoRelativeManifestPath(outsideHtmlPath) === '') {
    pass('PDF manifest leaves HTML column blank when source HTML is missing or outside the repo');
  } else {
    fail('PDF manifest mishandles missing or external source HTML paths');
  }

  const injectedPageCss = injectPrintPageCss('<html><head><title>CV</title></head><body></body></html>', 'letter');
  if (
    injectedPageCss.includes('@page { size: Letter; margin: var(--page-margin, 0.6in); }') &&
    injectedPageCss.indexOf('jobber-page-setup') < injectedPageCss.indexOf('</head>')
  ) {
    pass('PDF renderer injects CSS page size and margins before rendering');
  } else {
    fail('PDF renderer does not inject CSS page size/margins into the document head');
  }

  const mixedCasePageCss = injectPrintPageCss('<html><head></head><body></body></html>', 'Letter');
  if (mixedCasePageCss.includes('@page { size: Letter; margin: var(--page-margin, 0.6in); }')) {
    pass('PDF renderer treats page format case-insensitively');
  } else {
    fail('PDF renderer falls back to A4 for mixed-case letter format');
  }

  const doctypeNoHead = injectPrintPageCss('<!doctype html><html lang="en"><body></body></html>');
  if (
    doctypeNoHead.startsWith('<!doctype html>') &&
    doctypeNoHead.includes('<html lang="en">\n<head>\n<style id="jobber-page-setup">') &&
    doctypeNoHead.indexOf('<head>') < doctypeNoHead.indexOf('<body>')
  ) {
    pass('PDF renderer preserves doctype when injecting page CSS into full HTML without head');
  } else {
    fail('PDF renderer may insert page CSS before doctype for full HTML without head');
  }

  const fragmentPageCss = injectPrintPageCss('<section>CV</section>');
  if (fragmentPageCss.startsWith('<style id="jobber-page-setup">')) {
    pass('PDF renderer still prepends page CSS for HTML fragments');
  } else {
    fail('PDF renderer no longer handles HTML fragments with fallback CSS injection');
  }

  if (
    generatePdfScript.includes('preferCSSPageSize: true') &&
    generatePdfScript.includes("right: '0'") &&
    generatePdfScript.includes('injectPrintPageCss(html, format)') &&
    !/page\.pdf\(\{\s*format:/s.test(generatePdfScript)
  ) {
    pass('PDF renderer uses CSS @page margins instead of Playwright margins');
  } else {
    fail('PDF renderer may clip right-aligned content by ignoring CSS page sizing (#1341)');
  }
} catch (e) {
  fail(`PDF manifest path helper test crashed: ${e.message}`);
}

console.log('\n7b2. PDF renderer temporary-file cleanup');

try {
  const { renderHtmlToPdf } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'jobber-pdf-cleanup-launch-'));
  const launchError = new Error('injected browser launch failure');
  let caught;
  try {
    await renderHtmlToPdf('<html><body>PII_MARKER@example.com</body></html>', join(fixtureRoot, 'cv.pdf'), {
      baseDir: fixtureRoot,
      launchBrowser: async () => { throw launchError; },
    });
  } catch (error) {
    caught = error;
  }
  const leftovers = readdirSync(fixtureRoot)
    .filter((name) => name.startsWith('.jobber-render-'));
  if (caught === launchError && leftovers.length === 0) {
    pass('PDF renderer removes temporary HTML when Chromium launch fails');
  } else {
    fail(`PDF renderer leaked temporary HTML after launch failure: ${leftovers.join(', ')}`);
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
} catch (error) {
  fail(`PDF renderer launch-cleanup test crashed: ${error.message}`);
}

try {
  const { renderHtmlToPdf } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'jobber-pdf-cleanup-page-'));
  const pageError = new Error('injected newPage failure');
  let closeCalls = 0;
  let caught;
  try {
    await renderHtmlToPdf('<html><body>PRIVATE_CV_MARKER</body></html>', join(fixtureRoot, 'cv.pdf'), {
      baseDir: fixtureRoot,
      launchBrowser: async () => ({
        newPage: async () => { throw pageError; },
        close: async () => { closeCalls += 1; },
      }),
    });
  } catch (error) {
    caught = error;
  }
  const leftovers = readdirSync(fixtureRoot)
    .filter((name) => name.startsWith('.jobber-render-'));
  if (caught === pageError && closeCalls === 1 && leftovers.length === 0) {
    pass('PDF renderer closes Chromium and removes temporary HTML after launch');
  } else {
    fail(`PDF renderer post-launch cleanup mismatch: close=${closeCalls}, temp=${leftovers.join(', ')}`);
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
} catch (error) {
  fail(`PDF renderer post-launch cleanup test crashed: ${error.message}`);
}

// SECTION_ALIASES held English titles only, so a CV rendered in one of the
// shipped non-English modes produced zero sections comparable against the
// English cv.md: validateCvSectionOrder() saw fewer than two comparable
// sections and early-returned, and the guard silently did nothing. Polish
// (modes/pl) is covered here — a Polish CV that hoisted Education above
// Doświadczenie zawodowe used to render without complaint while the identical
// English CV was correctly rejected.

console.log('\n7e. CV section order check is language-aware');

for (const header of ['podsumowanie zawodowe', 'doświadczenie zawodowe', 'wykształcenie', 'certyfikaty', 'umiejętności']) {
  if (generatePdfScript.includes(`['${header}',`)) {
    pass(`SECTION_ALIASES maps Polish header: ${header}`);
  } else {
    fail(`SECTION_ALIASES missing Polish header: ${header}`);
  }
}

// generate-pdf.mjs imports playwright at module scope; degrade to a warning
// rather than crashing the suite where it is not installed.
let pdfModule = null;
try {
  pdfModule = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
} catch (e) {
  warn(`Cannot import generate-pdf.mjs (${e.code || e.message}) — skipping behavioral section-order tests`);
}

if (pdfModule) {
  const { sectionKey, validateCvSectionOrder } = pdfModule;

  // Canonical keys are language-independent; only the spelling differs.
  const keyCases = [
    ['Podsumowanie zawodowe', 'summary'],
    ['Kompetencje kluczowe', 'competencies'],
    ['Kluczowe kompetencje', 'competencies'], // word-order variant
    ['Doświadczenie zawodowe', 'experience'],
    ['Przebieg kariery', 'experience'],
    ['Wykształcenie', 'education'],
    ['Certyfikaty', 'certifications'],
    ['Umiejętności', 'skills'],
    ['Wyksztalcenie', 'education'],  // diacritics stripped
    ['Umiejetnosci', 'skills'],      // diacritics stripped
    ['Work Experience', 'experience'], // English must be unchanged
    ['Core Competencies', 'competencies'],
  ];
  let keysOk = true;
  for (const [title, expected] of keyCases) {
    const actual = sectionKey(title);
    if (actual !== expected) {
      fail(`sectionKey("${title}") = "${actual}", expected "${expected}"`);
      keysOk = false;
    }
  }
  if (keysOk) pass(`sectionKey resolves all ${keyCases.length} PL/EN heading spellings`);

  // Hermetic cv.md stand-in: passed in directly, so the test does not depend on
  // a cv.md existing in the checkout (it is gitignored).
  const cvMd = [
    '# CV', '## Professional Summary', '## Work Experience',
    '## Education', '## Certifications', '## Skills',
  ].join('\n');
  const titlesToHtml = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');

  const plCorrect = titlesToHtml([
    'Podsumowanie zawodowe', 'Kompetencje kluczowe', 'Doświadczenie zawodowe',
    'Wykształcenie', 'Certyfikaty', 'Umiejętności',
  ]);
  // Education hoisted above Work Experience — the divergence the guard exists to catch.
  const plMisordered = titlesToHtml([
    'Podsumowanie zawodowe', 'Wykształcenie', 'Doświadczenie zawodowe',
  ]);
  const enMisordered = titlesToHtml([
    'Professional Summary', 'Education', 'Work Experience',
  ]);

  const throws = (html, opts) => {
    try { validateCvSectionOrder(html, cvMd, opts); return false; } catch { return true; }
  };

  if (throws(plMisordered)) {
    pass('Polish CV with Education before Work Experience is rejected');
  } else {
    fail('Polish CV with Education before Work Experience was NOT rejected (guard is a no-op)');
  }

  if (!throws(plCorrect)) {
    pass('Polish CV in cv.md order is accepted');
  } else {
    fail('Polish CV in cv.md order was wrongly rejected');
  }

  if (throws(enMisordered)) {
    pass('English CV order check still rejects divergence (no regression)');
  } else {
    fail('English CV order check regressed');
  }

  // --allow-reorder must keep downgrading the divergence to a warning now that
  // Polish CVs actually reach this code path.
  if (!throws(plMisordered, { allowReorder: true })) {
    pass('allowReorder downgrades Polish divergence to a warning');
  } else {
    fail('allowReorder did not suppress Polish divergence');
  }
}
