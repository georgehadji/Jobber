// tests/set-status-transition-matrix.test.mjs — characterization of `node set-status.mjs`
// (STATE-MACHINES-PLAN Phase 1.3). Pins TODAY's behaviour for every ordered pair of the 9
// canonical states, with and without --force. No behaviour is changed or endorsed here.
//
// Expectation (hard-coded literals on purpose — not derived from states.yml, so a gate
// regression cannot hide by changing the table the expectation is computed from; a drift
// guard below ties the TERMINAL literal to states.yml):
//   from == to                        -> exit 0, no change, NO status-log row   (no-op)
//   from terminal, to != from, !force -> exit 1, code illegal-transition, cell + log untouched
//   everything else                   -> exit 0, cell == to, exactly one status-log row
// NB: SKIP is NOT terminal in states.yml (skip -> evaluated|discarded); only Rejected,
// Discarded and Hired are. Live states are free-form in both directions (corrections).
//
// KNOWN-BUG section (M1): non-canonical live cells (alias `Evaluada`, dated `Applied 2026-01-05`)
// are refused as terminal today. That is pinned via M1_FIXED below; Phase 3.2 flips it to true.
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadStateTransitions } from '../tracker-utils.mjs';

console.log('\nset-status transition matrix (9x9 x --force, characterization)');

// Phase 3.2 (canonicalize `from` via resolveCanonicalState) flips this to true.
const M1_FIXED = false;

const STATES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP', 'Hired'];
const TERMINAL = new Set(['Rejected', 'Discarded', 'Hired']);
const ON = '2026-01-05';
const SETSTATUS = join(ROOT, 'set-status.mjs');

const work = mkdtempSync(join(tmpdir(), 'ss-matrix-'));
let caseN = 0;

// One child process on a fresh one-row tracker (+ its sibling status-log.tsv).
// Resolves null when the child could not be run at all, so callers warn, never pass.
function attempt(existingStatus, target, force) {
  return new Promise(resolve => {
    let dir, tracker, logPath;
    try {
      dir = join(work, `c${caseN++}`);
      mkdirSync(join(dir, 'data'), { recursive: true });
      tracker = join(dir, 'data', 'applications.md');
      logPath = join(dir, 'data', 'status-log.tsv');
      writeFileSync(tracker, [
        '# Applications Tracker', '',
        '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
        '|---|------|---------|------|-------|--------|-----|--------|-------|',
        `| 1 | 2026-01-05 | Acme | Platform Engineer | 4.2/5 | ${existingStatus} | ❌ | — | fixture |`,
        '',
      ].join('\n'));
    } catch { return resolve(null); }
    const args = [SETSTATUS, '1', target, '--on', ON, '--json', ...(force ? ['--force'] : [])];
    const child = spawn(NODE, args, { env: { ...process.env, JOBBER_TRACKER: tracker }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === null) return resolve(null);
      let json = null;
      try { json = JSON.parse(stdout); } catch {}
      const row = readFileSync(tracker, 'utf-8').split('\n').find(l => l.startsWith('| 1 |')) ?? '';
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
      resolve({ code, json, stderr, cell: row.split('|')[6]?.trim(), log });
    });
  });
}

// Bounded parallelism so ~170 node spawns stay well under the time budget.
async function pool(jobs, width = 8) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

// Classify one observation into {kind, problems}; problems is [] when it matches `want`.
// kind: 'ok' | 'noop' | 'illegal-transition' | 'invalid-state' | other error code | 'crash'
function observe(res, from, to) {
  if (res.code === 0) return { kind: res.json?.changed === false ? 'noop' : 'ok', logRows: res.log === '' ? 0 : res.log.split('\n').filter(Boolean).length };
  return { kind: res.json?.code ?? 'crash', logRows: res.log === '' ? 0 : res.log.split('\n').filter(Boolean).length };
}
const expectedKind = (from, to, force) => from === to ? 'noop' : TERMINAL.has(from) && !force ? 'illegal-transition' : 'ok';
const logLine = (from, to) => `1\t${ON}\t${from}\t${to}\tset-status\t\n`;

try {
  // Drift guard: the TERMINAL literal above must equal states.yml's empty-transition states.
  const t = loadStateTransitions(join(ROOT, 'templates', 'states.yml'));
  const fromYml = STATES.filter(s => (t[s.toLowerCase()] ?? []).length === 0).sort().join(',');
  const lit = [...TERMINAL].sort().join(',');
  if (fromYml === lit) pass(`TERMINAL literal matches states.yml empty-transition states (${lit})`);
  else fail(`TERMINAL literal (${lit}) drifted from states.yml (${fromYml}) — update this test deliberately`);

  // ── full matrix ────────────────────────────────────────────────
  const cells = [];
  for (const force of [false, true]) for (const from of STATES) for (const to of STATES) cells.push({ from, to, force });
  const results = await pool(cells.map(c => () => attempt(c.from, c.to, c.force)));

  const tally = {};
  const surprises = [];
  for (const force of [false, true]) {
    for (const from of STATES) {
      const bad = [];
      let ran = 0;
      cells.forEach((c, i) => {
        if (c.force !== force || c.from !== from) return;
        const res = results[i];
        if (!res) { bad.push(`${c.to}: spawn/fixture failed`); return; }
        ran++;
        const obs = observe(res, c.from, c.to);
        tally[`${force ? 'force' : 'plain'}:${obs.kind}`] = (tally[`${force ? 'force' : 'plain'}:${obs.kind}`] ?? 0) + 1;
        const want = expectedKind(c.from, c.to, force);
        const refused = want === 'illegal-transition';
        const changed = want === 'ok';
        const problems = [];
        if (obs.kind !== want) problems.push(`kind ${obs.kind} (want ${want})`);
        if (res.code !== (refused ? 1 : 0)) problems.push(`exit ${res.code}`);
        if (res.cell !== (changed ? c.to : c.from)) problems.push(`cell "${res.cell}"`);
        // identity: a change appends exactly its own line; refusal and no-op append nothing
        if (res.log !== (changed ? logLine(c.from, c.to) : '')) problems.push(`status-log ${JSON.stringify(res.log)}`);
        if (problems.length) bad.push(`${c.from}->${c.to}: ${problems.join(', ')}`);
      });
      const label = `${from} -> * ${force ? 'with --force' : 'without --force'}`;
      if (ran === 0) warn(`${label}: no case could be run — not verified`);
      else if (bad.length === 0) pass(`${label}: all ${STATES.length} targets as pinned`);
      else { fail(`${label}: ${bad.join(' | ')}`); surprises.push(...bad); }
    }
  }
  // Control (AGENTS.md rule 1): the matrix must contain BOTH refusals and successes.
  const n = k => tally[k] ?? 0;
  if (n('plain:illegal-transition') === 24 && n('plain:ok') === 48 && n('plain:noop') === 9
    && n('force:ok') === 72 && n('force:noop') === 9 && n('force:illegal-transition') === 0) {
    pass('matrix tally: plain 24 refused / 48 changed / 9 no-op; --force 72 changed / 9 no-op / 0 refused');
  } else {
    fail(`matrix tally unexpected: ${JSON.stringify(tally)}`);
  }

  // ── invalid state (never reaches the tracker) ──────────────────
  const inv = await attempt('Evaluated', 'Bogus', false);
  if (!inv) warn('invalid-state case: fixture/spawn failed — not verified');
  else if (inv.code === 1 && inv.json?.code === 'invalid-state' && inv.cell === 'Evaluated' && inv.log === '') {
    pass('invalid target `Bogus`: exit 1, code invalid-state, cell and status-log untouched');
  } else fail(`invalid target: exit ${inv.code}, code ${inv.json?.code}, cell "${inv.cell}", log ${JSON.stringify(inv.log)}`);

  // ── KNOWN-BUG M1: non-canonical live cells (red repro: repro-set-status-noncanonical) ──
  // Today: refused as terminal without --force (WRONG — they are live rows). With --force the
  // change goes through and logs the raw cell as `from`. After Phase 3.2 set M1_FIXED = true:
  // the plain run is then expected to succeed; the --force expectations do not change.
  const m1 = [
    { existing: 'Evaluada', to: 'Applied' },
    { existing: 'Applied 2026-01-05', to: 'Interview' },
  ];
  for (const { existing, to } of m1) {
    const [plain, forced] = await Promise.all([attempt(existing, to, false), attempt(existing, to, true)]);
    if (!plain || !forced) { warn(`KNOWN-BUG M1 \`${existing}\` -> ${to}: fixture/spawn failed — not verified`); continue; }
    const plainOk = plain.code === 0 && plain.cell === to && plain.log === logLine(existing, to);
    const plainRefused = plain.code === 1 && plain.json?.code === 'illegal-transition' && plain.cell === existing && plain.log === '';
    const label = `KNOWN-BUG M1 \`${existing}\` -> ${to} without --force`;
    if (M1_FIXED ? plainOk : plainRefused) {
      pass(`${label}: ${M1_FIXED ? 'allowed (M1 fixed)' : 'wrongly refused as terminal (today; flip M1_FIXED after Phase 3.2)'}`);
    } else {
      fail(`${label}: M1_FIXED=${M1_FIXED} but observed exit ${plain.code}, code ${plain.json?.code}, cell "${plain.cell}", log ${JSON.stringify(plain.log)}`);
    }
    if (forced.code === 0 && forced.cell === to && forced.log === logLine(existing, to)) {
      pass(`KNOWN-BUG M1 \`${existing}\` -> ${to} with --force: changed, one status-log row`);
    } else fail(`KNOWN-BUG M1 \`${existing}\` -> ${to} with --force: exit ${forced.code}, cell "${forced.cell}", log ${JSON.stringify(forced.log)}`);
  }
  if (process.env.JOBBER_TEST_VERBOSE) console.log(`  tally: ${JSON.stringify(tally)}`);
} catch (e) {
  warn(`set-status matrix harness error: ${e.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
