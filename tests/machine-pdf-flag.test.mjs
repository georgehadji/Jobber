// tests/machine-pdf-flag.test.mjs — STATE-MACHINES-PLAN Phase 4.5 (M17): pdf-flag machine.
// Runs the real merge-tracker.mjs and sync-pdf-flags.mjs on a throwaway tracker and compares the
// glyphs they read/write with templates/machines/pdf-flag.yml. Declaration only; nothing is enforced.
import { pass, fail, warn, ROOT, NODE } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { loadMachine, canonicalize, check } from '../lib/state-machine.mjs';

console.log('\npdf-flag state machine (Phase 4.5 / M17)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const machine = loadMachine('pdf-flag');
const id = g => canonicalize(machine, g)?.id ?? null;

eq('loads valid: initial missing, generated is the only terminal state', [machine.initial, machine.states.filter(s => s.terminal).map(s => s.id)], ['missing', ['generated']]);
eq('the tracker glyphs map to slug ids (aliases)', [id('✅'), id('❌'), id('—'), id('-')], ['generated', 'missing', 'not-applicable', 'not-applicable']);
eq('control: a glyph outside the machine is unknown', id('📄'), null);

// fixture: three rows, one per glyph, all with a report that the manifest lists
const row = (n, co, glyph) => `| ${n} | 2026-01-0${n} | ${co} | Eng | 4.0/5 | Evaluated | ${glyph} | [${n}](reports/${n}-${co.toLowerCase()}.md) | |`;
const TRACKER = ['# Applications Tracker', '', '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |', '|---|------|---------|------|-------|--------|-----|--------|-------|',
  row(1, 'Acme', '❌'), row(2, 'Globex', '—'), row(3, 'Initech', '✅'), ''].join('\n');
const INDEX = '# report\tpdf\n1\toutput/1.pdf\n2\toutput/2.pdf\n3\toutput/3.pdf\n';
const glyphs = text => text.split('\n').filter(l => /^\| \d /.test(l)).map(l => l.split('|')[7].trim());

function sandbox() {
  try {
    const tmp = mkdtempSync(join(tmpdir(), 'jobber-pdfflag-'));
    mkdirSync(join(tmp, 'data'), { recursive: true });
    mkdirSync(join(tmp, 'reports'), { recursive: true });
    mkdirSync(join(tmp, 'additions'), { recursive: true });
    writeFileSync(join(tmp, 'data', 'applications.md'), TRACKER);
    writeFileSync(join(tmp, 'data', 'pdf-index.tsv'), INDEX);
    return { tmp, tracker: join(tmp, 'data', 'applications.md'), env: { ...process.env, JOBBER_TRACKER: join(tmp, 'data', 'applications.md'), JOBBER_ADDITIONS: join(tmp, 'additions'), JOBBER_PDF_INDEX: join(tmp, 'data', 'pdf-index.tsv') } };
  } catch (e) { warn(`pdf-flag sandbox could not be built: ${e.message}`); return null; }
}

// merge-tracker with nothing to add exits before it would call sync-pdf-flags, so only its own syncPdfFlags runs
{
  const sb = sandbox();
  if (sb) {
    try {
      const r = spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs')], { cwd: sb.tmp, env: sb.env, encoding: 'utf-8', timeout: 60000 });
      const after = glyphs(readFileSync(sb.tracker, 'utf-8'));
      eq('merge-tracker upgrades a ❌ row to ✅ but leaves the — row alone (declared: missing -> generated only)', [r.status, after], [0, ['✅', '—', '✅']]);
      eq('...which is a declared edge for the ❌ row, and the same machine declares — -> generated too (sync-pdf-flags\'s job)',
        [check(machine, '❌', '✅').kind, check(machine, '—', '✅').kind], ['forward', 'forward']);
    } finally { rmSync(sb.tmp, { recursive: true, force: true }); }
  }
}
{
  const sb = sandbox();
  if (sb) {
    try {
      const r = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs')], { cwd: sb.tmp, env: sb.env, encoding: 'utf-8', timeout: 60000 });
      eq('control: sync-pdf-flags upgrades BOTH ❌ and — (the asymmetry is real, not a fixture artefact)', [r.status, glyphs(readFileSync(sb.tracker, 'utf-8'))], [0, ['✅', '✅', '✅']]);
    } finally { rmSync(sb.tmp, { recursive: true, force: true }); }
  }
}
{
  // one-way: with an EMPTY manifest nothing downgrades ✅ (no writer produces ❌/— from ✅)
  const sb = sandbox();
  if (sb) {
    try {
      writeFileSync(sb.env.JOBBER_PDF_INDEX, '# report\tpdf\n');
      for (const script of ['merge-tracker.mjs', 'sync-pdf-flags.mjs']) spawnSync(NODE, [join(ROOT, script)], { cwd: sb.tmp, env: sb.env, encoding: 'utf-8', timeout: 60000 });
      eq('one-way: with no PDFs indexed, neither writer changes any glyph (including the ✅ row)', glyphs(readFileSync(sb.tracker, 'utf-8')), ['❌', '—', '✅']);
    } finally { rmSync(sb.tmp, { recursive: true, force: true }); }
  }
}

// every glyph the code literally writes as a PDF value is a machine alias (source text; absence of a
// stray glyph fails closed, a comment mention would only be a false positive)
for (const f of ['merge-tracker.mjs', 'sync-pdf-flags.mjs']) {
  const src = readFileSync(join(ROOT, f), 'utf-8');
  const written = [...new Set([...src.matchAll(/\bpdf(?:\s*:|\])\s*=?\s*'([^']+)'/g), ...src.matchAll(/parts\[colmap\.pdf\]\s*=\s*'([^']+)'/g)].map(m => m[1]))];
  eq(`${f}: every literal assigned to a pdf field is a pdf-flag glyph (found ${JSON.stringify(written)})`, [written.length > 0, written.filter(g => !id(g))], [true, []]);
}

// ── check() kinds ──
eq('❌ -> ✅ is a declared forward move', check(machine, '❌', '✅').kind, 'forward');
eq('✅ -> ❌ (a downgrade) leaves the terminal state and is refused', [check(machine, '✅', '❌').kind, check(machine, '✅', '❌').ok], ['terminal-exit', false]);
eq('❌ -> — is not a declared edge and policy forbids backward moves between live states', [check(machine, '❌', '—').kind, check(machine, '❌', '—').ok], ['illegal', false]);
eq('an unknown glyph is unknown-to', check(machine, '❌', '📄').kind, 'unknown-to');
