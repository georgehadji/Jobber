// tests/pipeline-inbox-localized.test.mjs — STATE-MACHINES-PLAN D11.
//   1. lib/pipeline-inbox parses and writes the localized section headers of modes/<lang>/pipeline.md
//      (it used to know only Pending/Processed and Pendientes/Procesadas).
//   2. a failed evaluation (throw OR null report) is marked `[!]` with a reason; success is not.
// Every header case has a control: the English file must behave exactly as before.
import { pass, fail, warn, ROOT } from './helpers.mjs';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SECTION_HEADERS, parseInbox, markProcessed, appendPending } from '../lib/pipeline-inbox.mjs';
import { pipelineFailureReason } from '../openrouter-runner.mjs';

console.log('\npipeline inbox: localized headers + failed evaluation marks [!] (D11)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const URL_A = 'https://a.example/jobs/1';
const URL_B = 'https://b.example/jobs/2';
const doc = (pend, proc) => `# Pipeline\n\n## ${pend}\n\n- [ ] ${URL_A} | Acme | Engineer\n\n## ${proc}\n\n- [x] #001 | ${URL_B} | Beta | SRE | 4.0/5 | PDF ✅\n`;

// ── 1. every language modes/<lang>/pipeline.md uses ──────────────────────
// Cross-check against the real files so the table cannot drift from the modes it mirrors.
try {
  const seen = new Set();
  for (const lang of readdirSync(join(ROOT, 'modes'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    let text;
    try { text = readFileSync(join(ROOT, 'modes', lang, 'pipeline.md'), 'utf8'); } catch { continue; }
    // the mode file documents a Pending and a Processed section: both must be recognised
    const pendHeader = SECTION_HEADERS.find((h) => new RegExp(`^## ${h[0]}\\s*$`, 'im').test(text));
    const procHeader = SECTION_HEADERS.find((h) => h.slice(1).some((n) => new RegExp(`^## ${n}\\s*$`, 'im').test(text)));
    if (pendHeader && procHeader) seen.add(lang); else fail(`modes/${lang}/pipeline.md: Pending/Processed headers not both in SECTION_HEADERS`);
  }
  eq('every modes/<lang>/pipeline.md Pending + Processed header is in SECTION_HEADERS', seen.size >= 15, true);
} catch (e) { warn(`could not scan modes/: ${e.message}`); }

for (const [pend, proc] of SECTION_HEADERS) {
  const rows = parseInbox(doc(pend, proc));
  const a = rows.find((r) => r.url === URL_A), b = rows.find((r) => r.url === URL_B);
  if (!(a?.state === 'pending' && a.section === 'pending' && b?.state === 'processed' && b.section === 'processed')) fail(`parse ${pend}/${proc}: ${JSON.stringify(rows.map((r) => [r.url, r.state, r.section]))}`);
}
pass(`parseInbox recognises Pending/Processed sections in all ${SECTION_HEADERS.length} languages`);

const work = mkdtempSync(join(tmpdir(), 'inbox-loc-'));
try {
  let n = 0;
  const fileWith = (text) => { const f = join(work, `p${n++}.md`); writeFileSync(f, text); return f; };

  // markProcessed moves the row into the EXISTING localized Processed section
  for (const [pend, proc] of SECTION_HEADERS) {
    const f = fileWith(`# Pipeline\n\n## ${pend}\n\n- [ ] ${URL_A} | Acme | Engineer\n\n## ${proc}\n\n`);
    await markProcessed(f, URL_A, { ref: '#007' });
    const out = readFileSync(f, 'utf8');
    const headers = out.split('\n').filter((l) => l.startsWith('## '));
    if (JSON.stringify(headers) !== JSON.stringify([`## ${pend}`, `## ${proc}`]) || !out.includes('- [x] #007 | ' + URL_A)) fail(`markProcessed ${pend}: headers ${JSON.stringify(headers)}\n${out}`);
  }
  pass('markProcessed lands in the existing localized Processed section (no duplicate English section) in every language');

  // no Processed section: it is created in the language of the Pending header
  for (const [pend, proc] of SECTION_HEADERS) {
    const f = fileWith(`# Pipeline\n\n## ${pend}\n\n- [ ] ${URL_A} | Acme | Engineer\n`);
    await markProcessed(f, URL_A, {});
    const headers = readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('## '));
    if (JSON.stringify(headers) !== JSON.stringify([`## ${pend}`, `## ${proc}`])) fail(`created Processed header for ${pend}: ${JSON.stringify(headers)}`);
  }
  pass('a missing Processed section is created in the language of the Pending header');

  // appendPending adds under the localized Pending header instead of a second English one
  for (const [pend, proc] of SECTION_HEADERS) {
    const f = fileWith(doc(pend, proc));
    await appendPending(f, ['- [ ] https://c.example/jobs/3 | Gamma | PM']);
    const out = readFileSync(f, 'utf8');
    const headers = out.split('\n').filter((l) => l.startsWith('## '));
    const pendBlock = out.slice(out.indexOf(`## ${pend}`), out.indexOf(`## ${proc}`));
    if (JSON.stringify(headers) !== JSON.stringify([`## ${pend}`, `## ${proc}`]) || !pendBlock.includes('https://c.example/jobs/3')) fail(`appendPending ${pend}: ${JSON.stringify(headers)}`);
  }
  pass('appendPending adds under the localized Pending header (no second Pending section)');

  // control: the English file behaves exactly as before, and a header that merely STARTS with a known name is not one
  const eng = fileWith('# P\n\n## Pending Review\n\n- [ ] ' + URL_A + ' | Acme | Engineer\n');
  eq('control: a "## Pending Review" heading is not a Pending section', parseInbox(readFileSync(eng, 'utf8'))[0].section, null);
  const f2 = fileWith(doc('Pending', 'Processed'));
  await markProcessed(f2, URL_A, { ref: '#009' });
  eq('control: the English file still moves the row under "## Processed"', readFileSync(f2, 'utf8').split('\n').filter((l) => l.startsWith('## ')), ['## Pending', '## Processed']);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ── 2. failed evaluation marks [!] ──────────────────────────────────────
eq('a thrown evaluation is an error with its own message', pipelineFailureReason(null, new Error('HTTP 403')), 'HTTP 403');
eq('a throw wins even when a report path exists', pipelineFailureReason('reports/001.md', new Error('late failure')), 'late failure');
const nullReason = pipelineFailureReason(null, null);
eq('a null report is now an error too (D11), saying how to retry', [typeof nullReason, /no report/.test(nullReason), /re-queue/.test(nullReason)], ['string', true, true]);
eq('control: a produced report is not an error', pipelineFailureReason('reports/001.md', null), null);
