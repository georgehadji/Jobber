// tests/status-normalizers-golden.test.mjs — Phase 1.1 characterization ("golden") tests.
//
// STATE-MACHINES-PLAN M1: the application-status vocabulary is re-implemented in
// many places and each copy handles aliases, dates, bold and unknown input a little
// differently. tests/fixtures/status-alias-corpus.tsv records what each one is
// SUPPOSED to do for 371 spellings — but its cells were produced by text-extracting
// and eval-ing source, so they are a claim, not proof.
//
// This file calls the REAL code for each normalizer and compares it with the corpus.
// It changes no behaviour: where the real output disagrees with a corpus cell, the
// real output is the truth, and the disagreement is pinned in CORPUS_BUGS below so a
// future refactor (Phase 3) has to change it on purpose.
//
// How each normalizer is reached (no production script is edited):
//   states.yml          loadCanonicalStates + resolveCanonicalState (exported, in-process)
//   stats               computeTrackerStats (exported, in-process; canonicalStatus is private)
//   followup-cadence    normalizeStatus (exported, in-process)
//   merge-tracker       validateStatus is private and the script runs on import -> spawn the
//                       CLI on a temp tracker (JOBBER_TRACKER / JOBBER_ADDITIONS)
//   normalize-statuses  same; spawned with --dry-run (nothing written) on a temp tracker
//   verify-pipeline     same; spawned on a temp tracker, accept/reject read from its output
//   web state-model.ts  canonStatus imported as TypeScript (Node type stripping); warn+skip
//                       when this Node cannot import .ts
// NOT covered: analyze-patterns (private normalizeStatus, no tracker env override),
// dedup-tracker (rank table only, no canonical output). Go NormalizeStatus (the go_dashboard
// column) is gated by dashboard/internal/data/status_corpus_test.go, run by `go test ./...`.
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nstatus normalizers — golden characterization over the alias corpus');

const CANONICAL = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Hired', 'Rejected', 'Discarded', 'SKIP'];
const PROBE = 'zzz-not-a-status'; // an obviously unknown spelling, appended after the corpus rows
const UNKNOWN = '-';              // corpus convention: "this normalizer does not recognise it"

// ── corpus ─────────────────────────────────────────────────────────────────
// Spellings are NOT trimmed: whitespace and bold variants are part of the corpus. Three
// placeholders encode blank input that cannot live in a TSV cell as-is.
const PLACEHOLDERS = { '<empty>': '', '<space>': ' ', '<nbsp>': '\u00a0' };
const decode = s => (Object.prototype.hasOwnProperty.call(PLACEHOLDERS, s) ? PLACEHOLDERS[s] : s);
const show = s => JSON.stringify(s);
const CORPUS = (() => {
  const lines = readFileSync(join(ROOT, 'tests/fixtures/status-alias-corpus.tsv'), 'utf-8').split('\n');
  const header = lines[0].replace(/\r$/, '').split('\t');
  return lines.slice(1).filter(l => l.length > 0).map(l => {
    const cells = l.replace(/\r$/, '').split('\t');
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
    row.spelling = decode(row.spelling);
    return row;
  });
})();
const SPELLINGS = [...CORPUS.map(r => r.spelling), PROBE];

// ── known corpus-vs-real disagreements (the REAL value wins) ───────────────
// { normalizer: { spelling: realValue } }. Filled from the first real run. Each entry is
// itself asserted to still disagree with the corpus, so the list cannot go stale.
const CORPUS_BUGS = {
  // The corpus says "-" (unknown) for whitespace- and bold-wrapped spellings, but the real
  // resolveCanonicalState trims and strips ** before matching, so all 42 resolve.
  states_yml: {},
  // The real CLI never reaches validateStatus for these: tracker-parse's column-swap guard
  // treats the cell as a score sentinel (N/A, DUP, em dash, hyphen) and skips the whole row.
  // validateStatus alone would say discarded / unknown, which is what the corpus recorded.
  merge_tracker: { DUP: 'skipped', '—': 'skipped', '-': 'skipped' },
  normalize_statuses: {},
  verify_pipeline: {},
  stats: {},
  web_format: {},
};
const WRAPPED = {
  Evaluated: 'evaluated', Applied: 'applied', Responded: 'responded', Interview: 'interview', Offer: 'offer',
  Hired: 'hired', Rejected: 'rejected', Discarded: 'discarded', Skip: 'skip',
  Aplicado: 'applied', Rechazado: 'rejected', Descartado: 'discarded', Contratado: 'hired', 'No aplicar': 'skip',
};
const SPANISH_BASES = new Set(['Aplicado', 'Rechazado', 'Descartado', 'Contratado', 'No aplicar']);
for (const [base, id] of Object.entries(WRAPPED)) {
  for (const wrapped of [` ${base} `, `${base}  `, `**${base}**`]) {
    CORPUS_BUGS.states_yml[wrapped] = id;
    // space-wrapped Spanish labels already agreed with the corpus on web (no pin needed)
    if (!(SPANISH_BASES.has(base) && !wrapped.startsWith('**'))) CORPUS_BUGS.web_format[wrapped] = id;
  }
}

// ── adapters: spelling -> real value, in corpus vocabulary ─────────────────
// Value is a lowercase state id, or UNKNOWN when the normalizer does not recognise the spelling.
const realValues = {};   // normalizer -> Map(spelling -> value)
const detail = {};       // extra facts per normalizer for the control assertions

function tracker(rows) {
  const head = ['# Applications Tracker', '', '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |', '|---|------|---------|------|-------|--------|-----|--------|-------|'];
  return head.concat(rows.map((s, i) => {
    const n = i + 1;
    return `| ${n} | 2026-01-01 | Zorb${n}x | Role ${n}x | 4.0/5 | ${s} | ✅ | [${n}](reports/${n}-z-2026-01-01.md) | note |`;
  })).join('\n') + '\n';
}

function withWorkspace(fn) {
  const work = mkdtempSync(join(tmpdir(), 'status-golden-'));
  try { return fn(work); } finally { rmSync(work, { recursive: true, force: true }); }
}

function runScript(script, args, env) {
  const r = spawnSync(NODE, [join(ROOT, script), ...args], { encoding: 'utf-8', timeout: 120000, cwd: ROOT, env: { ...process.env, ...env } });
  if (r.error) throw r.error;
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// states.yml (in-process)
async function adaptStatesYml() {
  const { loadCanonicalStates, resolveCanonicalState } = await import(pathToFileURL(join(ROOT, 'tracker-utils.mjs')).href);
  const states = loadCanonicalStates(join(ROOT, 'templates/states.yml'));
  return new Map(SPELLINGS.map(s => {
    const label = resolveCanonicalState(s, states);
    return [s, label === null ? UNKNOWN : label.toLowerCase()];
  }));
}

// stats.mjs canonicalStatus, reached through the exported computeTrackerStats (one row per call)
async function adaptStats() {
  const { computeTrackerStats } = await import(pathToFileURL(join(ROOT, 'stats.mjs')).href);
  detail.stats = {};
  return new Map(SPELLINGS.map(s => {
    const r = computeTrackerStats(tracker([s]));
    if (r.total !== 1) { detail.stats[s] = 'unparsed'; return [s, 'unparsed']; } // row never reached the normalizer
    const bucket = Object.entries(r.byStatus).find(([, n]) => n === 1)[0];
    detail.stats[s] = bucket;
    return [s, bucket === 'Unknown' ? UNKNOWN : bucket.toLowerCase()];
  }));
}

// followup-cadence normalizeStatus: returns the alias target, else the cleaned input unchanged
async function adaptFollowup() {
  const { normalizeStatus } = await import(pathToFileURL(join(ROOT, 'followup-cadence.mjs')).href);
  const ids = new Set(CANONICAL.map(c => c.toLowerCase()));
  detail.followup = {};
  return new Map(SPELLINGS.map(s => {
    const v = normalizeStatus(s);
    detail.followup[s] = v;
    return [s, ids.has(v) ? v : UNKNOWN];
  }));
}

// web canonStatus: lives in web/src/lib/core/state-model.ts (pure, no imports, so Node can load it
// directly); the machine comes from templates/states.yml via machineFromDoc, as the web app builds it.
async function adaptWeb() {
  const mod = await import(pathToFileURL(join(ROOT, 'web/src/lib/core/state-model.ts')).href);
  const yamlMod = await import('js-yaml');
  const yaml = yamlMod.default ?? yamlMod;
  const doc = yaml.load(readFileSync(join(ROOT, 'templates/states.yml'), 'utf-8'));
  const machine = mod.machineFromDoc(doc);
  if (!machine) throw new Error('machineFromDoc returned null for templates/states.yml');
  const canon = new Set(CANONICAL.map(c => c.toUpperCase()));
  detail.web = {};
  return new Map(SPELLINGS.map(s => {
    const v = mod.canonStatus(machine, s);
    detail.web[s] = v;
    return [s, canon.has(v) ? v.toLowerCase() : UNKNOWN];
  }));
}

// merge-tracker: one TSV addition per spelling, one real merge run
function adaptMerge() {
  return withWorkspace(work => {
    const trk = join(work, 'applications.md');
    const adds = join(work, 'adds');
    mkdirSync(adds);
    writeFileSync(trk, tracker([]));
    SPELLINGS.forEach((s, i) => {
      const n = i + 1;
      writeFileSync(join(adds, `${n}-z.tsv`), `${n}\t2026-01-01\tZorb${n}x\tRole ${n}x\t${s}\t4.0/5\t✅\t[${n}](reports/${n}-z-2026-01-01.md)\tnote\n`);
    });
    const r = runScript('merge-tracker.mjs', [], { JOBBER_TRACKER: trk, JOBBER_ADDITIONS: adds });
    if (r.status !== 0) throw new Error(`merge-tracker exited ${r.status}: ${r.out.slice(0, 300)}`);
    const finalByNum = new Map();
    for (const line of readFileSync(trk, 'utf-8').split('\n')) {
      const p = line.split('|').map(x => x.trim());
      if (/^\d+$/.test(p[1] || '')) finalByNum.set(Number(p[1]), p[6]);
    }
    // The fallback warning quotes the status it could not place; collect those.
    const warned = new Set([...r.out.matchAll(/Non-canonical status "([^"\n]*)" → defaulting/g)].map(m => m[1]));
    detail.merge = {};
    return new Map(SPELLINGS.map((s, i) => {
      const final = finalByNum.get(i + 1);
      // The TSV column-swap guard can refuse a row before validateStatus ever runs.
      if (final === undefined) { detail.merge[s] = 'skipped'; return [s, 'skipped']; }
      detail.merge[s] = final;
      // corpus convention: a warned fallback is shown as UNKNOWN, everything else as the landed state
      return [s, warned.has(s.trim()) && final === 'Evaluated' ? UNKNOWN : final.toLowerCase()];
    }));
  });
}

// normalize-statuses --dry-run: parse its report (changed rows, unknown rows, untouched rows)
function adaptNormalize() {
  return withWorkspace(work => {
    const trk = join(work, 'applications.md');
    writeFileSync(trk, tracker(SPELLINGS));
    const r = runScript('normalize-statuses.mjs', ['--dry-run'], { JOBBER_TRACKER: trk });
    if (r.status !== 0) throw new Error(`normalize-statuses exited ${r.status}: ${r.out.slice(0, 300)}`);
    const changed = new Map();   // num -> new label
    for (const m of r.out.matchAll(/^#(\d+): ".*" → "(.*)"$/gm)) changed.set(Number(m[1]), m[2]);
    const unknown = new Set([...r.out.matchAll(/^\s+#(\d+) \(line \d+\): ".*"$/gm)].map(m => Number(m[1])));
    detail.normalize = {};
    return new Map(SPELLINGS.map((s, i) => {
      const n = i + 1;
      if (unknown.has(n)) { detail.normalize[s] = 'unknown'; return [s, UNKNOWN]; }
      // No line at all = the cell already equals the canonical label it resolves to (or the
      // row never parsed, which only a non-canonical cell can mean).
      if (!changed.has(n)) {
        detail.normalize[s] = 'untouched';
        return [s, CANONICAL.includes(s.trim()) ? s.trim().toLowerCase() : 'unseen'];
      }
      detail.normalize[s] = `-> ${changed.get(n)}`;
      return [s, changed.get(n).toLowerCase()];
    }));
  });
}

// verify-pipeline: only accepts or rejects a status ("Non-canonical status" error); it never
// reports WHICH state a spelling means, so the compared value is 'accepted' / UNKNOWN.
function adaptVerify() {
  return withWorkspace(work => {
    const trk = join(work, 'applications.md');
    writeFileSync(trk, tracker(SPELLINGS));
    const r = runScript('verify-pipeline.mjs', [], { JOBBER_TRACKER: trk, JOBBER_REPORTS: join(work, 'reports') });
    if (!/Checking \d+ entries/.test(r.out)) throw new Error(`verify-pipeline did not run its checks: ${r.out.slice(0, 300)}`);
    const checked = Number(/Checking (\d+) entries/.exec(r.out)[1]);
    const rejected = new Set([...r.out.matchAll(/#(\d+): Non-canonical status/g)].map(m => Number(m[1])));
    if (checked !== SPELLINGS.length) throw new Error(`verify-pipeline parsed ${checked} of ${SPELLINGS.length} rows`);
    return new Map(SPELLINGS.map((s, i) => [s, rejected.has(i + 1) ? UNKNOWN : 'accepted']));
  });
}

const ADAPTERS = {
  states_yml: adaptStatesYml,
  merge_tracker: adaptMerge,
  normalize_statuses: adaptNormalize,
  verify_pipeline: adaptVerify,
  stats: adaptStats,
  web_format: adaptWeb,
};

// Setup failure is a warning, never a pass (AGENTS.md rule 5).
for (const [name, adapt] of Object.entries(ADAPTERS)) {
  try {
    realValues[name] = await adapt();
  } catch (e) {
    warn(`${name}: could not call the real normalizer, golden checks skipped (${String(e.message).split('\n')[0]})`);
  }
}
let followupReal = null;
try { followupReal = await adaptFollowup(); } catch (e) {
  warn(`followup-cadence: could not call the real normalizer, golden checks skipped (${String(e.message).split('\n')[0]})`);
}

// ── expectations ───────────────────────────────────────────────────────────
function corpusCell(normalizer, spelling) {
  if (spelling === PROBE) return UNKNOWN;
  const row = CORPUS.find(r => r.spelling === spelling);
  const cell = row[normalizer];
  return normalizer === 'verify_pipeline' ? (cell === UNKNOWN ? UNKNOWN : 'accepted') : cell;
}
function expected(normalizer, spelling) {
  const bugs = CORPUS_BUGS[normalizer] || {};
  return Object.prototype.hasOwnProperty.call(bugs, spelling) ? bugs[spelling] : corpusCell(normalizer, spelling);
}

// ── 1. golden table: real output === corpus (or the pinned real value) ─────
for (const normalizer of Object.keys(ADAPTERS)) {
  const real = realValues[normalizer];
  if (!real) continue;
  const mismatches = SPELLINGS
    .filter(s => real.get(s) !== expected(normalizer, s))
    .map(s => `${show(s)}: real=${real.get(s)} expected=${expected(normalizer, s)}`);
  if (mismatches.length === 0) pass(`${normalizer}: all ${SPELLINGS.length} spellings match the golden table`);
  else fail(`${normalizer}: ${mismatches.length} spelling(s) differ from the golden table — ${mismatches.slice(0, 15).join(' | ')}`);
}

// followup-cadence has no corpus column of its own: it is the alias table that stats.mjs
// uses. Known stats spellings must give the same id; stats-unknown spellings must stay
// outside the canonical ids (the function passes unknown input through unchanged).
if (followupReal && realValues.stats) {
  const bad = SPELLINGS
    .filter(s => followupReal.get(s) !== realValues.stats.get(s))
    .map(s => `${show(s)}: followup=${followupReal.get(s)} stats=${realValues.stats.get(s)}`);
  if (bad.length === 0) pass(`followup-cadence normalizeStatus agrees with stats for all ${SPELLINGS.length} spellings`);
  else fail(`followup-cadence normalizeStatus disagrees with stats for ${bad.length} spelling(s) — ${bad.slice(0, 12).join(' | ')}`);
}

// ── 2. the pinned disagreements are real (a fixed corpus must drop its override) ──
for (const [normalizer, bugs] of Object.entries(CORPUS_BUGS)) {
  const entries = Object.entries(bugs);
  if (entries.length === 0 || !realValues[normalizer]) continue;
  const stale = entries.filter(([sp, v]) => corpusCell(normalizer, sp) === v).map(([sp]) => show(sp));
  const unreal = entries.filter(([sp, v]) => realValues[normalizer].get(sp) !== v).map(([sp]) => show(sp));
  if (stale.length === 0 && unreal.length === 0) pass(`${normalizer}: ${entries.length} pinned real value(s) all differ from the corpus cell`);
  else fail(`${normalizer}: stale CORPUS_BUGS entries (corpus now agrees, delete): ${stale.join(', ') || 'none'}; entries the real code does not produce: ${unreal.join(', ') || 'none'}`);
}

// ── 3. controls: canonical labels map to themselves ────────────────────────
for (const normalizer of ['states_yml', 'merge_tracker', 'normalize_statuses', 'stats', 'web_format']) {
  const real = realValues[normalizer];
  if (!real) continue;
  const wrong = CANONICAL.filter(c => real.get(c) !== c.toLowerCase()).map(c => `${c} -> ${real.get(c)}`);
  if (wrong.length === 0) pass(`${normalizer}: every canonical label maps to itself`);
  else fail(`${normalizer}: canonical label(s) not mapped to themselves: ${wrong.join(', ')}`);
}
if (followupReal) {
  const wrong = CANONICAL.filter(c => followupReal.get(c) !== c.toLowerCase()).map(c => `${c} -> ${followupReal.get(c)}`);
  if (wrong.length === 0) pass('followup-cadence: every canonical label maps to itself');
  else fail(`followup-cadence: canonical label(s) not mapped to themselves: ${wrong.join(', ')}`);
}
if (realValues.verify_pipeline) {
  const wrong = CANONICAL.filter(c => realValues.verify_pipeline.get(c) !== 'accepted');
  if (wrong.length === 0) pass('verify-pipeline: every canonical label is accepted');
  else fail(`verify-pipeline: canonical label(s) rejected: ${wrong.join(', ')}`);
}

// ── 4. controls: an unknown string is handled DIFFERENTLY by each normalizer ──
// (this is the M1 "unknown status handled six ways" finding, pinned)
const only = (cond, msg) => (cond ? pass(msg) : fail(msg));
if (realValues.states_yml) only(realValues.states_yml.get(PROBE) === UNKNOWN, 'states.yml resolveCanonicalState: unknown input -> null (strict)');
if (detail.merge) only(detail.merge[PROBE] === 'Evaluated' && realValues.merge_tracker.get(PROBE) === UNKNOWN, 'merge-tracker: unknown input -> warning + lands as Evaluated');
if (detail.normalize) only(detail.normalize[PROBE] === 'unknown', 'normalize-statuses: unknown input -> listed as unknown, left untouched');
if (realValues.verify_pipeline) only(realValues.verify_pipeline.get(PROBE) === UNKNOWN, 'verify-pipeline: unknown input -> "Non-canonical status" error');
if (detail.stats) only(detail.stats[PROBE] === 'Unknown', 'stats: unknown input -> counted in the Unknown bucket');
if (detail.followup) only(detail.followup[PROBE] === PROBE, 'followup-cadence: unknown input -> passed through unchanged');
if (detail.web) only(detail.web[PROBE] === PROBE.toUpperCase(), 'web canonStatus: unknown input -> upper-cased passthrough');
