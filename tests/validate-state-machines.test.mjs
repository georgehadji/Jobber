// tests/validate-state-machines.test.mjs — the state-machine ratchet (STATE-MACHINES-PLAN Phase 5.1).
// Spawns validate-state-machines.mjs against (a) the real tree and (b) throwaway roots built with
// --root, so every rule gets a control (clean) and a violation case, and the message must NAME the
// offending file. The real tree is never modified.
// Fixture text is built from the registry at run time (AGENTS.md rule 6): no canonical status label
// is spelled out in this file, so it cannot match its own subject.
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { loadMachine, describe } from '../lib/state-machine.mjs';
import { regenerate } from '../lib/machine-blocks.mjs';

console.log('\nvalidate-state-machines (ratchet)');

const SCRIPT = join(ROOT, 'validate-state-machines.mjs');
const ALLOW = 'tests/fixtures/state-literal-allowlist.json';
const labels = loadMachine('application-status').states.map(s => s.label);
const q = l => `'${l}'`;
const run = (args, cwd = ROOT) => spawnSync(NODE, [SCRIPT, ...args], { encoding: 'utf-8', timeout: 120_000, cwd });
const out = r => `${r.stdout}${r.stderr}`;

const tmps = [];
/** A throwaway repo root: the real registry plus `files` ({relpath: text}). */
function mkRoot(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jobber-vsm-'));
  tmps.push(dir);
  mkdirSync(join(dir, 'templates'), { recursive: true });
  cpSync(join(ROOT, 'templates', 'states.yml'), join(dir, 'templates', 'states.yml'));
  cpSync(join(ROOT, 'templates', 'machines'), join(dir, 'templates', 'machines'), { recursive: true });
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

/** expect(exit, [substrings that must appear], [substrings that must not]) */
function expectRun(name, r, { status, has = [], hasNot = [] }) {
  const text = out(r);
  const missing = has.filter(s => !text.includes(s));
  const extra = hasNot.filter(s => text.includes(s));
  if (r.status === status && !missing.length && !extra.length) pass(name);
  else fail(`${name} — exit ${r.status} (want ${status}); missing ${JSON.stringify(missing)}; unexpected ${JSON.stringify(extra)}\n${text.trim().slice(0, 600)}`);
}

try {
  // ── real tree ────────────────────────────────────────────────────────────
  {
    const r = run([]);
    if (r.error || r.status === null) warn('validate-state-machines could not run on the real tree — not verified');
    else expectRun('real tree passes (every site is allowlisted or in the registry; generated blocks fresh)', r, { status: 0 });
    const j = run(['--json']);
    let parsed = null;
    try { parsed = JSON.parse(j.stdout); } catch { /* reported below */ }
    if (parsed && parsed.ok === true && Array.isArray(parsed.violations) && parsed.violations.length === 0) pass('--json: ok true with an empty violations array');
    else fail(`--json output malformed or not ok: ${j.stdout.slice(0, 200)}`);
  }

  // ── control: an empty root is clean ──────────────────────────────────────
  expectRun('control: registry-only root passes', run(['--root', mkRoot()]), { status: 0 });

  // ── rule 1: hard-coded lists ─────────────────────────────────────────────
  const three = labels.slice(0, 3);
  const arr = `export const A = [${three.map(q).join(', ')}];\n`;
  expectRun('rule 1: array of 3 canonical labels is flagged and names file:line',
    run(['--root', mkRoot({ 'src/list.mjs': arr })]), { status: 1, has: ['rule 1', 'src/list.mjs:1'] });
  expectRun('rule 1 control: 2 labels in an array pass',
    run(['--root', mkRoot({ 'src/list.mjs': `export const A = [${labels.slice(0, 2).map(q).join(', ')}];\n` })]), { status: 0 });
  expectRun('rule 1 control: the same array inside a comment passes',
    run(['--root', mkRoot({ 'src/list.mjs': `// ${arr}` })]), { status: 0 });
  expectRun('rule 1 control: tests/fixtures is skipped',
    run(['--root', mkRoot({ 'tests/fixtures/list.mjs': arr })]), { status: 0 });
  expectRun('rule 1 control: the same labels in separate arrays (2 + 1) pass',
    run(['--root', mkRoot({ 'src/list.mjs': `const A = [${q(labels[0])}, ${q(labels[1])}];\nconst B = [${q(labels[2])}];\n` })]), { status: 0 });
  expectRun('rule 1: switch with 3 case labels is flagged',
    run(['--root', mkRoot({ 'src/sw.mjs': `switch (x) {\n${three.map(l => `  case ${q(l)}: return 1;`).join('\n')}\n}\n` })]), { status: 1, has: ['src/sw.mjs:2'] });
  expectRun('rule 1: Go slice literal is flagged',
    run(['--root', mkRoot({ 'pkg/s.go': `var s = []string{${three.map(l => JSON.stringify(l)).join(', ')}}\n` })]), { status: 1, has: ['pkg/s.go:1'] });
  expectRun('rule 1: TS union of 3 labels is flagged',
    run(['--root', mkRoot({ 'web/t.ts': `export type S = ${three.map(l => JSON.stringify(l)).join(' | ')};\n` })]), { status: 1, has: ['web/t.ts:1'] });
  expectRun('rule 1: shell case pattern is flagged',
    run(['--root', mkRoot({ 'run.sh': `case "$s" in\n  ${three.map(l => l.toLowerCase()).join('|')}) echo ok ;;\nesac\n` })]), { status: 1, has: ['run.sh:2'] });
  expectRun('rule 1: a generated block (>>> machine: ... <<< machine:) is exempt',
    run(['--root', mkRoot({ 'run.sh': `# >>> machine:x:begin\nS="${three.join(' ')}"\n# <<< machine:x:end\n` })]), { status: 0 });

  // ── allowlist: shrink-only ───────────────────────────────────────────────
  const sig = [...three].map(l => l.toLowerCase()).sort().join(',');
  const allow = (rule1 = {}, rule2 = {}) => JSON.stringify({ rule1, rule2 });
  expectRun('allowlist: a listed site passes',
    run(['--root', mkRoot({ 'src/list.mjs': arr, [ALLOW]: allow({ 'src/list.mjs': [sig] }) })]), { status: 0 });
  expectRun('allowlist: a STALE entry (site gone) fails and names the entry',
    run(['--root', mkRoot({ 'src/other.mjs': 'export const A = 1;\n', [ALLOW]: allow({ 'src/list.mjs': [sig] }) })]), { status: 1, has: ['stale allowlist entry', sig] });
  expectRun('allowlist: a SECOND identical site in the same file is new (one entry absorbs one site)',
    run(['--root', mkRoot({ 'src/list.mjs': arr + arr, [ALLOW]: allow({ 'src/list.mjs': [sig] }) })]), { status: 1, has: ['src/list.mjs:2'], hasNot: ['stale'] });
  expectRun('allowlist: a listed site whose labels changed is both new and stale',
    run(['--root', mkRoot({ 'src/list.mjs': `export const A = [${labels.slice(0, 4).map(q).join(', ')}];\n`, [ALLOW]: allow({ 'src/list.mjs': [sig] }) })]), { status: 1, has: ['hard-coded state list', 'stale allowlist entry'] });

  // ── rule 2: unlisted writers of persisted files ──────────────────────────
  const writeApps = "import { writeFileSync } from 'fs';\nwriteFileSync(join(ROOT, 'data', 'applications.md'), text);\n";
  expectRun('rule 2: a file not in any writers: list that writes the tracker is flagged',
    run(['--root', mkRoot({ 'rogue.mjs': writeApps })]), { status: 1, has: ['rule 2', 'rogue.mjs:2', 'data/applications.md'] });
  expectRun('rule 2 control: a file listed in pdf-flag writers (sync-pdf-flags.mjs) passes',
    run(['--root', mkRoot({ 'sync-pdf-flags.mjs': writeApps })]), { status: 0 });
  expectRun('rule 2 control: a file that only READS the tracker passes',
    run(['--root', mkRoot({ 'rogue.mjs': "import { readFileSync } from 'fs';\nconst t = readFileSync(join(ROOT, 'data', 'applications.md'), 'utf-8');\n" })]), { status: 0 });
  expectRun('rule 2 control: writing some OTHER file passes',
    run(['--root', mkRoot({ 'rogue.mjs': "writeFileSync(join(ROOT, 'data', 'notes.md'), text);\n" })]), { status: 0 });
  expectRun('rule 2: a variable bound to the path is followed (const P = ...; appendFileSync(P, ..))',
    run(['--root', mkRoot({ 'rogue.mjs': "const P = join(ROOT, 'data', 'scan-history.tsv');\nappendFileSync(P, row);\n" })]), { status: 1, has: ['rogue.mjs:2', 'data/scan-history.tsv'] });
  expectRun('rule 2: rename onto the persisted path is flagged',
    run(['--root', mkRoot({ 'rogue.mjs': "renameSync(tmp, join(ROOT, 'data', 'portal-health.tsv'));\n" })]), { status: 1, has: ['data/portal-health.tsv'] });
  expectRun('rule 2: shell redirect to batch-state.tsv from an unlisted script is flagged',
    run(['--root', mkRoot({ 'rogue.sh': 'STATE_FILE="$D/batch-state.tsv"\necho row >> "$STATE_FILE"\n' })]), { status: 1, has: ['rogue.sh:2', 'batch/batch-state.tsv'] });
  expectRun('rule 2 control: the same redirect from batch/batch-runner.sh (a declared writer) passes',
    run(['--root', mkRoot({ 'batch/batch-runner.sh': 'STATE_FILE="$D/batch-state.tsv"\necho row >> "$STATE_FILE"\n' })]), { status: 0 });
  expectRun('rule 2 control: test files are not production writers',
    run(['--root', mkRoot({ 'tests/x.test.mjs': writeApps })]), { status: 0 });
  expectRun('rule 2 allowlist: a listed writer passes',
    run(['--root', mkRoot({ 'rogue.mjs': writeApps, [ALLOW]: allow({}, { 'rogue.mjs': ['data/applications.md'] }) })]), { status: 0 });
  expectRun('rule 2 allowlist: stale writer entry fails',
    run(['--root', mkRoot({ 'rogue.mjs': 'export {};\n', [ALLOW]: allow({}, { 'rogue.mjs': ['data/applications.md'] }) })]), { status: 1, has: ['stale allowlist entry', 'data/applications.md'] });

  // ── rule 3: generated blocks ─────────────────────────────────────────────
  const begin = '<!-- machine:application-status begin -->';
  const end = '<!-- machine:application-status end -->';
  const stale = `# Notes\n${begin}\nstale text\n${end}\n`;
  expectRun('rule 3: a stale generated block fails and names the file',
    run(['--root', mkRoot({ 'notes.md': stale })]), { status: 1, has: ['rule 3', 'notes.md'] });
  const fresh = regenerate(stale, id => describe(loadMachine(id))).text;
  expectRun('rule 3 control: the regenerated block passes',
    run(['--root', mkRoot({ 'notes.md': fresh })]), { status: 0 });

  // ── usage ────────────────────────────────────────────────────────────────
  expectRun('usage: unknown flag exits 2', run(['--nope']), { status: 2 });
} finally {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
}
