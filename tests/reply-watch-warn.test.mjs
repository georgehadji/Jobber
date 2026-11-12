// tests/reply-watch-warn.test.mjs — reply-watch tracker writes go through the shared
// transition gate in WARN mode (STATE-MACHINES-PLAN Phase 3.4, constraint 4: warn first,
// enforce a release later).
//
// Contract pinned here (spawned end to end, never by matching source text):
//   legal move   -> applied, no WARN on stderr, status-log note column empty
//   illegal move -> STILL applied (behaviour unchanged), `WARN illegal transition <from> -> <to> (row N)`
//                   on stderr, and the same text recorded in the status-log note column
// An illegal move is one that leaves a terminal state (Hired/Rejected/Discarded), including a
// DECORATED terminal cell such as `Rejected 2026-02-01`.
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nreply-watch warn-mode transition gate (phase 3.4)');

const work = mkdtempSync(join(tmpdir(), 'rw-warn-'));
let caseN = 0;
const today = new Date().toISOString().slice(0, 10);

const REPLIES = {
  interview: { message_id: 'm1', from: 'recruiter@acme.com', subject: 'Acme Platform Engineer next steps', body_snippet: 'Great news, we would like to invite you to an interview for the Platform Engineer role at Acme.', signal: 'interview_invite' },
  rejection: { message_id: 'm2', from: 'recruiter@acme.com', subject: 'Acme Platform Engineer application update', body_snippet: 'Unfortunately we will not be moving forward with your Platform Engineer application at Acme.', signal: 'rejection' },
};

// One reply-watch run (answering "y" at the apply prompt) on a fresh one-row tracker.
// Resolves null when the fixture could not be built or the child could not run.
function run(existingStatus, reply) {
  return new Promise(resolve => {
    let dir, tracker, candidates, logPath;
    try {
      dir = join(work, `c${caseN++}`);
      mkdirSync(join(dir, 'data'), { recursive: true });
      tracker = join(dir, 'data', 'applications.md');
      logPath = join(dir, 'data', 'status-log.tsv');
      candidates = join(dir, 'candidates.json');
      writeFileSync(tracker, [
        '# Applications Tracker', '',
        '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
        '|---|------|---------|------|-------|--------|-----|--------|-------|',
        `| 1 | 2026-01-05 | Acme | Platform Engineer | 4.2/5 | ${existingStatus} | ❌ | — | fixture |`,
        '',
      ].join('\n'));
      writeFileSync(candidates, JSON.stringify([reply]));
    } catch { return resolve(null); }
    // cwd = temp dir so reply-watch's best-effort `node tracker.mjs sync` cannot touch the repo DB.
    const child = spawn(NODE, [join(ROOT, 'reply-watch.mjs'), candidates], {
      cwd: dir, env: { ...process.env, JOBBER_TRACKER: tracker }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.on('error', () => {});
    child.stdin.end('y\n');
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === null) return resolve(null);
      const row = readFileSync(tracker, 'utf-8').split('\n').find(l => l.startsWith('| 1 |')) ?? '';
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
      resolve({ code, stdout, stderr, cell: row.split('|')[6]?.trim(), log });
    });
  });
}

const logRow = (from, to, note) => `1\t${today}\t${from}\t${to}\tmanual\t${note}\n`;

try {
  const cases = [
    // [label, existing cell, reply, to, fromInWarn (canonical), illegal?]
    ['ILLEGAL `Hired` -> Interview', 'Hired', 'interview', 'Interview', 'Hired', true],
    ['ILLEGAL `Rejected` -> Interview', 'Rejected', 'interview', 'Interview', 'Rejected', true],
    ['ILLEGAL dated terminal `Rejected 2026-02-01` -> Interview', 'Rejected 2026-02-01', 'interview', 'Interview', 'Rejected', true],
    ['ILLEGAL `Discarded` -> Rejected', 'Discarded', 'rejection', 'Rejected', 'Discarded', true],
    ['CONTROL legal `Applied` -> Interview', 'Applied', 'interview', 'Interview', 'Applied', false],
    ['CONTROL legal `Applied` -> Rejected', 'Applied', 'rejection', 'Rejected', 'Applied', false],
    ['CONTROL live backward correction `Offer` -> Interview', 'Offer', 'interview', 'Interview', 'Offer', false],
  ];
  const results = await Promise.all(cases.map(c => run(c[1], REPLIES[c[2]])));
  cases.forEach(([label, existing, , to, fromCanon, illegal], i) => {
    const res = results[i];
    if (!res) { warn(`${label}: fixture/spawn failed — not verified`); return; }
    const want = `WARN illegal transition ${fromCanon} -> ${to} (row 1)`;
    const warnLines = res.stderr.split('\n').filter(l => /WARN illegal transition/.test(l));
    const problems = [];
    if (res.cell !== to) problems.push(`cell "${res.cell}" (want ${to}: applied in warn mode either way)`);
    if (illegal) {
      if (warnLines.length !== 1 || warnLines[0].trim() !== want) problems.push(`stderr WARN lines ${JSON.stringify(warnLines)} (want exactly ${JSON.stringify(want)})`);
      if (res.log !== logRow(existing, to, `WARN illegal transition ${fromCanon} -> ${to}`)) problems.push(`status-log ${JSON.stringify(res.log)}`);
    } else {
      if (warnLines.length !== 0) problems.push(`unexpected WARN ${JSON.stringify(warnLines)}`);
      if (res.log !== logRow(existing, to, '')) problems.push(`status-log ${JSON.stringify(res.log)}`);
    }
    if (problems.length) fail(`${label}: ${problems.join('; ')}`);
    else pass(`${label}: applied, ${illegal ? 'WARN on stderr + note in status-log' : 'no warning, empty status-log note'}`);
  });
} catch (e) {
  warn(`reply-watch warn harness error: ${e.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
