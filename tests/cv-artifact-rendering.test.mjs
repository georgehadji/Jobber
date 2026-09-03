/**
 * cv-artifact-rendering.test.mjs — cover-letter templating (greeting block,
 * single-pass token substitution), local-font inlining to data: URLs (#951),
 * LaTeX validator i18n + the LaTeX-tex in-place tailoring pipeline (extract /
 * patch / compile-only), CJK CV rendering font fallbacks, ATS ligature
 * suppression, and the opt-in profile-photo slot (#264).
 *
 * Extracted verbatim from test-all.mjs (see tests/README.md — discovered
 * files are auto-run by both test-all.mjs and test-runner.mjs).
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT, NODE } from './helpers.mjs';

// ── 17. COVER LETTER GREETING BLOCK ─────────────────────────────

console.log('\n17. Cover letter greeting block');

try {
  const { buildHtml } = await import(pathToFileURL(join(ROOT, 'generate-cover-letter.mjs')).href);

  const basePayload = {
    candidate: { name: 'Jane Doe' },
    letter: {
      role_title: 'Head of Applied AI',
      opening: 'OPENING_MARKER sentence.',
      profile_intro: 'Profile intro.',
    },
  };

  // (a) greeting present → renders <p class="greeting"> above the opening
  const withGreeting = buildHtml({
    ...basePayload,
    letter: { ...basePayload.letter, greeting: 'Dear Hiring Manager,' },
  });
  const greetingTag = '<p class="greeting">Dear Hiring Manager,</p>';
  const greetingIdx = withGreeting.indexOf(greetingTag);
  const openingIdx = withGreeting.indexOf('OPENING_MARKER');
  if (greetingIdx !== -1 && openingIdx !== -1 && greetingIdx < openingIdx) {
    pass('Greeting renders as <p class="greeting"> above the opening');
  } else {
    fail(`Greeting block missing or misordered (greeting=${greetingIdx}, opening=${openingIdx})`);
  }

  // greeting text is HTML-escaped
  const escaped = buildHtml({
    ...basePayload,
    letter: { ...basePayload.letter, greeting: 'Dear <O\'Brien> & "Co",' },
  });
  if (escaped.includes('Dear &lt;O&#39;Brien&gt; &amp; &quot;Co&quot;,') && !escaped.includes('Dear <O\'Brien>')) {
    pass('Greeting text is HTML-escaped');
  } else {
    fail('Greeting text was not HTML-escaped');
  }

  // (b) greeting omitted → no salutation, no leftover token (backward compatible)
  const withoutGreeting = buildHtml(basePayload);
  if (!withoutGreeting.includes('class="greeting"')
      && !withoutGreeting.includes('{{GREETING_BLOCK}}')
      && withoutGreeting.includes('OPENING_MARKER')) {
    pass('Omitted greeting leaves no salutation and no leftover token (backward compatible)');
  } else {
    fail('Omitted greeting did not render cleanly (stray greeting markup or unreplaced token)');
  }
} catch (e) {
  fail(`Cover letter greeting test crashed: ${e.message}`);
}

// ── 18. COVER LETTER SINGLE-PASS SUBSTITUTION ───────────────────

console.log('\n18. Cover letter single-pass substitution');

try {
  const { buildHtml } = await import(pathToFileURL(join(ROOT, 'generate-cover-letter.mjs')).href);

  // A field value that itself contains literal {{TOKEN}} sequences must NOT be
  // re-substituted. The old iterative split/join loop would have blanked these
  // (no footnotes/closing in the payload → replaced with ""). Single-pass leaves
  // them verbatim because replacement output is never re-scanned.
  const injected = buildHtml({
    candidate: { name: 'Jane Doe' },
    letter: {
      role_title: 'Engineer',
      opening: 'See {{FOOTNOTES_BLOCK}} and {{CLOSING_BLOCK}} markers.',
      profile_intro: 'Intro.',
    },
  });

  if (injected.includes('See {{FOOTNOTES_BLOCK}} and {{CLOSING_BLOCK}} markers.')) {
    pass('Field values containing {{TOKEN}} are left literal (single-pass, not re-substituted)');
  } else {
    fail('A field value containing {{TOKEN}} was re-substituted');
  }

  // Known template tokens still resolve, and no unreplaced tokens leak through.
  if (injected.includes('Jane Doe') && !injected.includes('{{NAME}}') && !injected.includes('{{ROLE_TITLE}}')) {
    pass('Known template tokens still substitute under single-pass');
  } else {
    fail('Single-pass substitution left a known token unreplaced');
  }

  // CLI arguments: --help prints custom --format and --report usage guidelines
  const usageOut = execFileSync(process.execPath, [join(ROOT, 'generate-cover-letter.mjs'), '--help'], { encoding: 'utf-8' });
  if (usageOut.includes('--format') && usageOut.includes('--report') && usageOut.includes('[--format letter|a4]')) {
    pass('Cover letter CLI --help documents format and report options');
  } else {
    fail('Cover letter CLI --help does not document format and report options');
  }
} catch (e) {
  fail(`Cover letter single-pass substitution test crashed: ${e.message}`);
}

// ── 19. FONT INLINING (#951) ────────────────────────────────────

console.log('\n19. Font inlining (data: URLs, #951)');

try {
  // Importing must not trigger the CLI (the import.meta.url guard); it
  // exposes inlineLocalFonts, which renderHtmlToPdf runs before setContent.
  const { inlineLocalFonts } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);

  // Chromium blocks file:// subresources from setContent() pages (the page
  // stays at about:blank), so ./fonts refs must become data: URLs (#951).
  const fontFile = readdirSync(join(ROOT, 'fonts')).find(f => f.endsWith('.woff2'));
  const inlined = await inlineLocalFonts(
    `<style>@font-face { src: url('./fonts/${fontFile}') format('woff2'); }</style>`
  );
  if (inlined.includes('data:font/woff2;base64,') && !inlined.includes('./fonts/')) {
    pass('local ./fonts references are inlined as data: URLs');
  } else {
    fail('./fonts reference was not inlined as a data: URL — fonts will silently fall back (#951)');
  }

  // A missing font file must not corrupt the HTML or throw.
  const missing = await inlineLocalFonts(`<style>src: url('./fonts/does-not-exist.woff2');</style>`);
  if (missing.includes(`url('./fonts/does-not-exist.woff2')`)) {
    pass('missing font files keep their original reference');
  } else {
    fail('missing font file mangled the url() reference');
  }

  // Traversal outside fonts/ must never be inlined — neither via ".."
  // segments nor via absolute names (resolve() returns those verbatim).
  const traversal = await inlineLocalFonts(`<style>src: url('./fonts/../cv.md');</style>`);
  if (traversal.includes(`url('./fonts/../cv.md')`)) {
    pass('path traversal outside fonts/ is not inlined');
  } else {
    fail('path traversal escaped the fonts/ directory');
  }
  const absolute = await inlineLocalFonts(`<style>src: url('./fonts//etc/passwd');</style>`);
  if (absolute.includes(`url('./fonts//etc/passwd')`)) {
    pass('absolute-path escape (./fonts//etc/passwd) is not inlined');
  } else {
    fail('absolute-path reference escaped the fonts/ directory');
  }
} catch (e) {
  fail(`font inlining test crashed: ${e.message}`);
}

// ── 20. LATEX VALIDATOR I18N ────────────────────────────────────

console.log('\n20. LaTeX validator i18n (localized sections + CJK guard)');

// Run generate-latex.mjs and return its JSON report, capturing stdout even
// when it exits non-zero (validation issues exit 1 but still print the report).
function latexValidate(tex) {
  const dir = mkdtempSync(join(tmpdir(), 'latex-i18n-'));
  const texPath = join(dir, 'cv.tex');
  writeFileSync(texPath, tex, 'utf-8');
  let out;
  try {
    out = execFileSync(NODE, ['generate-latex.mjs', texPath], { cwd: ROOT, encoding: 'utf-8', timeout: 30000 });
  } catch (e) {
    out = (e.stdout || '').toString();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  try { return JSON.parse(out); } catch { return null; }
}

const baseTex = (sectionTitle) => `\\documentclass{article}
\\pdfgentounicode=1
\\begin{document}
\\section{${sectionTitle}}
\\section{Experiencia}
\\section{Proyectos}
\\section{Habilidades}
\\resumeSubheading
\\resumeItem
\\resumeProjectHeading
\\end{document}
`;

try {
  // Localized (Spanish) section titles must not trigger a "Missing section".
  const localized = latexValidate(baseTex('Educación'));
  if (localized && !localized.issues.some((i) => /section/i.test(i))) {
    pass('localized section titles validate (no spurious "Missing section")');
  } else {
    fail(`localized section titles wrongly flagged: ${JSON.stringify(localized && localized.issues)}`);
  }

  // Too few sections must still be flagged.
  const tooFew = latexValidate(`\\documentclass{article}
\\pdfgentounicode=1
\\begin{document}
\\section{Education}
\\resumeSubheading
\\resumeItem
\\resumeProjectHeading
\\end{document}
`);
  if (tooFew && tooFew.issues.some((i) => /at least 4/i.test(i))) {
    pass('fewer than 4 sections is still flagged');
  } else {
    fail('section-count check did not flag a CV with too few sections');
  }

  // CJK content must be rejected with actionable guidance.
  const cjk = latexValidate(baseTex('職務経歴'));
  if (cjk && cjk.issues.some((i) => /CJK/.test(i)) && cjk.valid === false) {
    pass('CJK content is rejected with guidance to use pdf mode');
  } else {
    fail(`CJK content was not rejected with guidance: ${JSON.stringify(cjk && cjk.issues)}`);
  }
} catch (e) {
  fail(`LaTeX validator i18n test crashed: ${e.message}`);
}

// ── 20b. LATEX-TEX IN-PLACE TAILORING ───────────────────────────

console.log('\n20b. LaTeX-tex in-place tailoring (extract / patch / compile-only)');

try {
  const { detectFamily, buildManifest, applyPatches } = await import(pathToFileURL(join(ROOT, 'lib/latex-content.mjs')).href);
  const { validateLatexContent, compileLatexFile } = await import(pathToFileURL(join(ROOT, 'generate-latex.mjs')).href);

  const resumeFixture = readFileSync(join(ROOT, 'examples/latex-tex/resume-subheading.tex'), 'utf-8');
  const tabularFixture = readFileSync(join(ROOT, 'examples/latex-tex/tabularx-itemize.tex'), 'utf-8');

  if (detectFamily(resumeFixture) === 'resumeSubheading') {
    pass('resume-subheading fixture detected as resumeSubheading family');
  } else {
    fail('resume-subheading fixture family detection failed');
  }

  if (detectFamily(tabularFixture) === 'tabularx-itemize') {
    pass('tabularx-itemize fixture detected as tabularx-itemize family');
  } else {
    fail('tabularx-itemize fixture family detection failed');
  }

  if (detectFamily('\\documentclass{article}\\begin{document}Hello\\end{document}') === null) {
    pass('unknown LaTeX layout returns null family');
  } else {
    fail('unknown LaTeX layout should not match a supported family');
  }

  const manifest = buildManifest('resume-subheading.tex', resumeFixture);
  if (manifest.supported && manifest.slots.length >= 3) {
    pass(`resume-subheading manifest exposes editable slots (${manifest.slots.length})`);
  } else {
    fail(`resume-subheading manifest missing slots: ${JSON.stringify(manifest)}`);
  }

  const tabManifest = buildManifest('tabularx-itemize.tex', tabularFixture);
  if (tabManifest.supported && tabManifest.slots.length >= 2) {
    pass(`tabularx-itemize manifest exposes item slots (${tabManifest.slots.length})`);
  } else {
    fail(`tabularx-itemize manifest missing slots: ${JSON.stringify(tabManifest)}`);
  }

  const firstBullet = manifest.slots.find(s => s.kind === 'bullet');
  if (firstBullet) {
    const patched = applyPatches(resumeFixture, [{ id: firstBullet.id, text: 'Tailored summary bullet for testing.' }], manifest.slots);
    if (patched.includes('Tailored summary bullet for testing.')) {
      pass('applyPatches rewrites a resumeItem bullet in place');
    } else {
      fail('applyPatches did not insert tailored bullet text');
    }
  } else {
    fail('resume-subheading manifest has no bullet slot to patch');
  }

  // resumeItemWithoutTitle variant: `\resumeItemWithoutTitle{}{...}` bullets,
  // `\resumeSubItem{Cat}{items}` skills, and preamble macro defs that must NOT
  // leak into slots (the defs contain \resumeItem{#1}{#2} / \textbf{#1}{: #2}).
  const withoutTitleFixture = readFileSync(join(ROOT, 'examples/latex-tex/resume-subheading-withouttitle.tex'), 'utf-8');

  if (detectFamily(withoutTitleFixture) === 'resumeSubheading') {
    pass('resumeItemWithoutTitle fixture detected as resumeSubheading family');
  } else {
    fail('resumeItemWithoutTitle fixture family detection failed');
  }

  const wtManifest = buildManifest('resume-subheading-withouttitle.tex', withoutTitleFixture);
  const wtBullets = wtManifest.slots.filter(s => s.kind === 'bullet');
  const wtSkills = wtManifest.slots.filter(s => s.kind === 'skill');
  if (wtBullets.length === 2 && wtSkills.length === 3) {
    pass('resumeItemWithoutTitle manifest extracts 2 bullets + 3 skill values');
  } else {
    fail(`resumeItemWithoutTitle slot mismatch (want 2 bullets/3 skills): ${JSON.stringify(wtManifest.slots.map(s => ({ id: s.id, text: s.text.slice(0, 40) })))}`);
  }

  if (wtManifest.slots.every(s => !s.text.includes('#1') && !s.text.includes('#2'))) {
    pass('preamble macro definitions are not extracted as slots');
  } else {
    fail('extraction leaked preamble macro definitions (#1/#2) into slots');
  }

  if (wtManifest.slots.every(s => !s.text.includes('Stale commented bullet'))) {
    pass('commented-out macro calls are not extracted as slots');
  } else {
    fail('extraction leaked a commented-out bullet into slots');
  }

  // Slot spans must point at the prose group: patching every slot with its own
  // extracted text must reproduce the input byte-for-byte.
  const wtRoundTrip = applyPatches(
    withoutTitleFixture,
    wtManifest.slots.map(s => ({ id: s.id, text: s.text })),
    wtManifest.slots,
    { escape: false },
  );
  if (wtRoundTrip === withoutTitleFixture) {
    pass('no-op patch round-trip is byte-identical (spans point at prose groups)');
  } else {
    fail('no-op patch round-trip altered the document — slot spans are misaligned');
  }

  const wtBullet = wtBullets[0];
  const wtPatched = applyPatches(withoutTitleFixture, [{ id: wtBullet.id, text: 'Tailored withouttitle bullet.' }], wtManifest.slots);
  if (wtPatched.includes('\\resumeItemWithoutTitle{}{Tailored withouttitle bullet.}')) {
    pass('applyPatches rewrites a resumeItemWithoutTitle bullet in place');
  } else {
    fail('applyPatches did not rewrite the resumeItemWithoutTitle prose group');
  }

  const compileOnlyTex = `\\documentclass{article}\\begin{document}Minimal user CV\\end{document}`;
  const compileOnlyValidation = validateLatexContent(compileOnlyTex, true);
  if (compileOnlyValidation.issues.length === 0) {
    pass('--compile-only validation accepts minimal user .tex without Jobber macros');
  } else {
    fail(`compile-only validation too strict: ${compileOnlyValidation.issues.join('; ')}`);
  }

  const strictValidation = validateLatexContent(compileOnlyTex, false);
  if (strictValidation.issues.some(i => /section|resumeSubheading|pdfgentounicode/i.test(i))) {
    pass('default validation still enforces Jobber template checks');
  } else {
    fail('default validation should reject non-template .tex');
  }

  const extractDir = mkdtempSync(join(tmpdir(), 'latex-tex-'));
  const extractOut = join(extractDir, 'manifest.json');
  execFileSync(NODE, ['extract-latex-content.mjs', join(ROOT, 'examples/latex-tex/resume-subheading.tex'), '--out', extractOut], { cwd: ROOT, encoding: 'utf-8' });
  const extracted = JSON.parse(readFileSync(extractOut, 'utf-8'));
  const patchPayload = {
    slots: extracted.slots,
    patches: [{ id: extracted.slots[0].id, text: 'CLI patch path works.' }],
  };
  const patchJson = join(extractDir, 'patches.json');
  const patchedTex = join(extractDir, 'out.tex');
  writeFileSync(patchJson, JSON.stringify(patchPayload));
  execFileSync(NODE, ['patch-latex-content.mjs', join(ROOT, 'examples/latex-tex/resume-subheading.tex'), patchJson, patchedTex], { cwd: ROOT, encoding: 'utf-8' });
  const patchedContent = readFileSync(patchedTex, 'utf-8');
  if (patchedContent.includes('CLI patch path works.')) {
    pass('extract-latex-content.mjs + patch-latex-content.mjs CLI round-trip');
  } else {
    fail('CLI patch round-trip did not update the .tex file');
  }
  rmSync(extractDir, { recursive: true, force: true });

  // B7-D1: compileLatexFile() must run the CV fact gate before ever touching
  // a LaTeX engine — before this fix it had no fact check at all (structural
  // validation only), so a fabricated metric compiled straight through.
  // Confirmed live against a real pdflatex install during defect-hunt batch 7
  // (see docs/DEFECT-HUNT-LEDGER.md B7-D1); this test only needs to confirm
  // the gate fires before compilation is attempted, not exercise a real
  // engine (no toolchain dependency in CI).
  const factGateTexDir = mkdtempSync(join(tmpdir(), 'latex-fact-gate-'));
  const factGateTexPath = join(factGateTexDir, 'fabricated.tex');
  const fabricatedTex = [
    '\\documentclass{article}',
    '\\pdfgentounicode=1',
    '\\begin{document}',
    '\\section{Experience}',
    '\\resumeSubheading{x}{y}{z}{w}',
    '\\resumeItem{Increased company-wide revenue by 500% at Acme Corp.}',
    '\\resumeProjectHeading{x}{y}',
    '\\section{Education}', 'text',
    '\\section{Skills}', 'text',
    '\\section{Projects}', 'text',
    '\\end{document}',
  ].join('\n');
  writeFileSync(factGateTexPath, fabricatedTex, 'utf-8');
  const factGateReport = await compileLatexFile(factGateTexPath, fabricatedTex, null, false);
  rmSync(factGateTexDir, { recursive: true, force: true });
  if (
    factGateReport.valid === false &&
    factGateReport.issues.some(i => /Fact check failed for CV \(LaTeX\)/.test(i)) &&
    factGateReport.engine === undefined
  ) {
    pass('compileLatexFile() blocks a fabricated metric before attempting compilation');
  } else {
    fail(`compileLatexFile() did not block the fabricated CV: ${JSON.stringify(factGateReport)}`);
  }
} catch (e) {
  fail(`LaTeX-tex tailoring test crashed: ${e.message}`);
}

// ── 21. CJK CV RENDERING (Japanese + Simplified Chinese) ─────────

console.log('\n21. CJK CV rendering (lang="ja" font fallback)');

try {
  // The bundled webfonts are Latin-only, so a Japanese CV (html lang="ja")
  // needs a CJK system-font fallback or it renders as tofu (□) in headless
  // Chromium. This mirrors the existing lang="ar" handling.
  const template = readFileSync(join(ROOT, 'templates', 'cv-template.html'), 'utf-8');

  if (/html\[lang="ja"\]\s+body/.test(template)) {
    pass('cv-template.html has a lang="ja" body rule for CJK text');
  } else {
    fail('cv-template.html is missing a lang="ja" font fallback — Japanese CVs render as tofu (□)');
  }

  // The fallback must name a real CJK font family, not just rely on sans-serif
  // (the generic sans-serif has no CJK glyphs on minimal/CI environments).
  const cjkFonts = ['Hiragino Sans', 'Yu Gothic', 'Noto Sans CJK JP', 'Noto Sans JP', 'Meiryo', 'MS PGothic'];
  const jaBlock = template.slice(template.indexOf('html[lang="ja"]'));
  if (cjkFonts.some((f) => jaBlock.includes(f))) {
    pass('lang="ja" rules name a concrete CJK font family');
  } else {
    fail('lang="ja" rules do not name any CJK font family — CJK fallback will not work');
  }

  for (const templateName of ['cv-template.html', 'resume-template.html']) {
    const zhTemplate = readFileSync(join(ROOT, 'templates', templateName), 'utf-8');
    const zhStart = zhTemplate.indexOf('html[lang="zh-CN"] body');
    const zhBlock = zhStart >= 0 ? zhTemplate.slice(zhStart) : '';
    const zhFonts = ['PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC'];

    if (zhStart >= 0 && zhFonts.some((font) => zhBlock.includes(font))) {
      pass(`${templateName} has concrete zh-CN font fallbacks`);
    } else {
      fail(`${templateName} is missing concrete zh-CN font fallbacks`);
    }

    if (/line-break:\s*strict/.test(zhBlock) && /overflow-wrap:\s*break-word/.test(zhBlock)) {
      pass(`${templateName} applies strict Chinese line breaking without clipping long mixed tokens`);
    } else {
      fail(`${templateName} is missing zh-CN line-breaking safeguards`);
    }

    if (/html\[lang="zh-CN"\]\s+\.contact-row/.test(zhBlock)) {
      pass(`${templateName} applies an explicit zh-CN fallback to contact details`);
    } else {
      fail(`${templateName} is missing an explicit zh-CN contact-row fallback`);
    }
  }

  const resumeHtml = readFileSync(join(ROOT, 'templates', 'resume-template.html'), 'utf-8');
  const resumeZhBlock = resumeHtml.slice(resumeHtml.indexOf('html[lang="zh-CN"] body'));
  const headingGroup = resumeZhBlock.slice(resumeZhBlock.indexOf('html[lang="zh-CN"] .header h1'), resumeZhBlock.indexOf('html[lang="zh-CN"] .summary-text'));
  if (!/\.competency-tag|\.skill-category/.test(headingGroup)) {
    pass('resume-template.html keeps competency and skill labels out of the zh-CN heading-font group');
  } else {
    fail('resume-template.html assigns competency or skill labels to the zh-CN heading font');
  }
} catch (e) {
  fail(`CJK rendering test crashed: ${e.message}`);
}

// ── 27. ATS LIGATURE SUPPRESSION ────────────────────────────────

console.log('\n27. ATS ligature suppression');

try {
  // Headless Chromium substitutes fi/fl/ffi with the Unicode ligature glyphs
  // U+FB01/FB02/FB03 at PDF layout time. PDF text extractors (what ATS reads)
  // decode them back to those codepoints, so "verification" parses as
  // "veriﬁcation" and a literal keyword search misses it. The templates disable
  // common, contextual, and discretionary ligatures in CSS so the output stays
  // font-independent. A live render-and-extract test is font and OS dependent
  // (the bug only appears where a ligature-bearing font is installed), so it is
  // not reliable in CI; this guards the CSS source, which is the fix itself.
  const LIGATURE_TEMPLATES = [
    'cv-template.html',
    'resume-template.html',
    'cover-letter-template.html',
  ];
  const variantRe = /font-variant-ligatures:\s*none/;
  const featureRe = /font-feature-settings:\s*"liga"\s*0\s*,\s*"clig"\s*0\s*,\s*"dlig"\s*0/;

  for (const name of LIGATURE_TEMPLATES) {
    const css = readFileSync(join(ROOT, 'templates', name), 'utf-8');
    if (variantRe.test(css) && featureRe.test(css)) {
      pass(`${name} disables ligatures (font-variant-ligatures + font-feature-settings)`);
    } else {
      fail(`${name} is missing ligature suppression (PDF text extraction would read "veriﬁcation" not "verification")`);
    }
  }
} catch (e) {
  fail(`ATS ligature suppression test crashed: ${e.message}`);
}

// ── 28. OPTIONAL PROFILE PHOTO (opt-in, DACH/European — #264) ────

console.log('\n28. Optional profile photo (opt-in, DACH/European, #264)');

try {
  const cvTemplate = readFileSync(join(ROOT, 'templates', 'cv-template.html'), 'utf-8');

  // The opt-in photo must exist as a .cv-photo CSS rule.
  if (/\.cv-photo\s*\{/.test(cvTemplate)) {
    pass('cv-template.html defines a .cv-photo rule');
  } else {
    fail('cv-template.html is missing a .cv-photo rule — #264 opt-in photo not wired');
  }

  // It MUST be floated (taken out of normal flow) so a present photo is wrapped
  // by the text beside it (the classic DACH top-corner photo) and an absent one
  // leaves the layout unchanged. Anchor the check to the .cv-photo rule block so
  // it can't accidentally read another rule (e.g. the lang="ar" float:left
  // mirror) via offset slicing.
  const photoRule = cvTemplate.match(/\.cv-photo\s*\{[^}]*\}/);
  if (photoRule && /float:\s*right/.test(photoRule[0])) {
    pass('.cv-photo floats right (text wraps when present; absent ⇒ unchanged layout)');
  } else {
    fail('.cv-photo must float so a present photo sits beside the text and an absent one does not shift the layout (#264)');
  }

  // The photo is an opt-in {{PHOTO}} slot, empty by default. The agent fills it
  // only when config/profile.yml sets candidate.photo; otherwise it stays empty.
  if (cvTemplate.includes('{{PHOTO}}')) {
    pass('cv-template.html exposes a {{PHOTO}} opt-in slot (empty by default)');
  } else {
    fail('cv-template.html is missing the {{PHOTO}} opt-in slot (#264)');
  }

  // The slot MUST sit before the header (outside .header): the float anchors at
  // the top of the page, and removing the line when absent cannot then perturb
  // the header's own structure. Guards against a regression that moves the slot
  // inside .header (which would shift the photoless layout).
  const photoIdx = cvTemplate.indexOf('{{PHOTO}}');
  const headerIdx = cvTemplate.indexOf('<!-- HEADER -->');
  if (photoIdx !== -1 && headerIdx !== -1 && photoIdx < headerIdx) {
    pass('{{PHOTO}} slot precedes the header (outside .header — keeps the photoless layout intact)');
  } else {
    fail('{{PHOTO}} slot must sit before <!-- HEADER --> so an absent photo leaves the header unchanged (#264)');
  }

  // The shipped template must NOT carry an active <img>: photos are opt-in,
  // never the default (recruiters in the US/UK/many markets penalize photos).
  if (!/<img[^>]*class="cv-photo"/.test(cvTemplate)) {
    pass('default template has no active <img class="cv-photo"> (opt-in, not default)');
  } else {
    fail('cv-template.html ships an active photo <img> — photos must be opt-in, never default (#264)');
  }

  // RTL (Arabic) must mirror the photo to the opposite corner, like the other
  // lang="ar" rules in this template.
  if (/html\[lang="ar"\]\s+\.cv-photo/.test(cvTemplate)) {
    pass('lang="ar" mirrors .cv-photo to the opposite corner');
  } else {
    fail('cv-template.html is missing an RTL mirror for .cv-photo (#264)');
  }

  const resumeTemplate = readFileSync(join(ROOT, 'templates', 'resume-template.html'), 'utf-8');

  // The opt-in photo must exist as a .cv-photo CSS rule.
  if (/\.cv-photo\s*\{/.test(resumeTemplate)) {
    pass('resume-template.html defines a .cv-photo rule');
  } else {
    fail('resume-template.html is missing a .cv-photo rule — #264 opt-in photo not wired');
  }

  // It MUST be floated (taken out of normal flow) so a present photo is wrapped
  // by the text beside it (the classic DACH top-corner photo) and an absent one
  // leaves the layout unchanged. Anchor the check to the .cv-photo rule block so
  // it can't accidentally read another rule (e.g. the lang="ar" float:left
  // mirror) via offset slicing.
  const photoRuleResume = resumeTemplate.match(/\.cv-photo\s*\{[^}]*\}/);
  if (photoRuleResume && /float:\s*right/.test(photoRuleResume[0])) {
    pass('.cv-photo floats right in resume-template.html (text wraps when present; absent ⇒ unchanged layout)');
  } else {
    fail('.cv-photo must float in resume-template.html so a present photo sits beside the text and an absent one does not shift the layout (#264)');
  }

  // The photo is an opt-in {{PHOTO}} slot, empty by default. The agent fills it
  // only when config/profile.yml sets candidate.photo; otherwise it stays empty.
  if (resumeTemplate.includes('{{PHOTO}}')) {
    pass('resume-template.html exposes a {{PHOTO}} opt-in slot (empty by default)');
  } else {
    fail('resume-template.html is missing the {{PHOTO}} opt-in slot (#264)');
  }

  // The slot MUST sit before the header (outside .header): the float anchors at
  // the top of the page, and removing the line when absent cannot then perturb
  // the header's own structure. Guards against a regression that moves the slot
  // inside .header (which would shift the photoless layout).
  const photoIdxResume = resumeTemplate.indexOf('{{PHOTO}}');
  const headerIdxResume = resumeTemplate.indexOf('<!-- HEADER -->');
  if (photoIdxResume !== -1 && headerIdxResume !== -1 && photoIdxResume < headerIdxResume) {
    pass('{{PHOTO}} slot precedes the header in resume-template.html (outside .header — keeps the photoless layout intact)');
  } else {
    fail('{{PHOTO}} slot must sit before <!-- HEADER --> in resume-template.html so an absent photo leaves the header unchanged (#264)');
  }

  // The shipped template must NOT carry an active <img>: photos are opt-in,
  // never the default (recruiters in the US/UK/many markets penalize photos).
  if (!/<img[^>]*class="cv-photo"/.test(resumeTemplate)) {
    pass('default resume template has no active <img class="cv-photo"> (opt-in, not default)');
  } else {
    fail('resume-template.html ships an active photo <img> — photos must be opt-in, never default (#264)');
  }

  // RTL (Arabic) must mirror the photo to the opposite corner, like the other
  // lang="ar" rules in this template.
  if (/html\[lang="ar"\]\s+\.cv-photo/.test(resumeTemplate)) {
    pass('lang="ar" mirrors .cv-photo to the opposite corner in resume-template.html');
  } else {
    fail('resume-template.html is missing an RTL mirror for .cv-photo (#264)');
  }
} catch (e) {
  fail(`profile photo test crashed: ${e.message}`);
}
