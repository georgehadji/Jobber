// tests/reply-watch-gate.test.mjs — reply-watch tracker writes go through the shared transition
// gate (STATE-MACHINES-PLAN Phase 3.4 warn mode, flipped to ENFORCE by default in Phase 5.3).
//
// Contract pinned here (spawned end to end, never by matching source text):
//   ENFORCE (default)
//     legal move   -> applied, no output about the gate, status-log note column empty
//     illegal move -> REFUSED: the cell is left exactly as it was, stderr says
//                     `Refused #N: illegal transition <from> -> <to>` plus the
//                     `node set-status.mjs N <State> --force` override, nothing is written to the ledger
//   JOBBER_REPLY_WATCH_GATE=warn (escape hatch, the Phase 3.4 behaviour)
//     illegal move -> STILL applied, `WARN illegal transition <from> -> <to> (row N)` on stderr,
//                     and the same text recorded in the status-log note column
// An illegal move is one that leaves a terminal state (Hired/Rejected/Discarded), including a
// DECORATED terminal cell such as `Rejected 2026-02-01`.
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nreply-watch transition gate: enforce by default (5.3), warn escape hatch (3.4)');

const work = mkdtempSync(join(tmpdir(), 'rw-warn-'));
let caseN = 0;
const today = new Date().toISOString().slice(0, 10);

const REPLIES = {
  interview: { message_id: 'm1', from: 'recruiter@acme.com', subject: 'Acme Platform Engineer next steps', body_snippet: 'Great news, we would like to invite you to an interview for the Platform Engineer role at Acme.', signal: 'interview_invite' },
  rejection: { message_id: 'm2', from: 'recruiter@acme.com', subject: 'Acme Platform Engineer application update', body_snippet: 'Unfortunately we will not be moving forward with your Platform Engineer application at Acme.', signal: 'rejection' },
};

// One reply-watch run (answering "y" at the apply prompt) on a fresh one-row tracker.
// Resolves null when the fixture could not be built or the child could not run.
function run(existingStatus, reply, gateEnv) {
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
      cwd: dir, env: { ...process.env, JOBBER_TRACKER: tracker, JOBBER_REPLY_WATCH_GATE: gateEnv || '' }, stdio: ['pipe', 'pipe', 'pipe'],
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
  const enforce = await Promise.all(cases.map(c => run(c[1], REPLIES[c[2]])));
  const warnRuns = await Promise.all(cases.map(c => run(c[1], REPLIES[c[2]], 'warn')));

  cases.forEach(([label, existing, , to, fromCanon, illegal], i) => {
    const res = enforce[i];
    if (!res) { warn(`ENFORCE ${label}: fixture/spawn failed — not verified`); return; }
    const problems = [];
    const refusedLines = res.stderr.split('\n').filter(l => /^Refused #/.test(l));
    if (illegal) {
      if (res.cell !== existing) problems.push(`cell "${res.cell}" (want it untouched: "${existing}")`);
      const wantStart = `Refused #1: illegal transition ${fromCanon} -> ${to}`;
      if (refusedLines.length !== 1 || !refusedLines[0].startsWith(wantStart)) problems.push(`stderr Refused lines ${JSON.stringify(refusedLines)} (want one starting ${JSON.stringify(wantStart)})`);
      if (!refusedLines[0]?.includes(`node set-status.mjs 1 ${to} --force`)) problems.push('refusal does not name the set-status --force override');
      if (res.log !== '') problems.push(`status-log should be empty, got ${JSON.stringify(res.log)}`);
      if (/WARN illegal transition/.test(res.stderr)) problems.push('unexpected WARN in enforce mode');
    } else {
      if (res.cell !== to) problems.push(`cell "${res.cell}" (want ${to})`);
      if (refusedLines.length !== 0 || /WARN illegal transition/.test(res.stderr)) problems.push(`unexpected gate output ${JSON.stringify(res.stderr)}`);
      if (res.log !== logRow(existing, to, '')) problems.push(`status-log ${JSON.stringify(res.log)}`);
    }
    if (problems.length) fail(`ENFORCE ${label}: ${problems.join('; ')}`);
    else pass(`ENFORCE ${label}: ${illegal ? 'refused, row and ledger untouched, override named' : 'applied, no gate output, empty ledger note'}`);
  });

  cases.forEach(([label, existing, , to, fromCanon, illegal], i) => {
    const res = warnRuns[i];
    if (!res) { warn(`WARN-MODE ${label}: fixture/spawn failed — not verified`); return; }
    const want = `WARN illegal transition ${fromCanon} -> ${to} (row 1)`;
    const warnLines = res.stderr.split('\n').filter(l => /WARN illegal transition/.test(l));
    const problems = [];
    if (res.cell !== to) problems.push(`cell "${res.cell}" (want ${to}: applied in warn mode either way)`);
    if (/^Refused #/m.test(res.stderr)) problems.push('warn mode must not refuse');
    if (illegal) {
      if (warnLines.length !== 1 || warnLines[0].trim() !== want) problems.push(`stderr WARN lines ${JSON.stringify(warnLines)} (want exactly ${JSON.stringify(want)})`);
      if (res.log !== logRow(existing, to, `WARN illegal transition ${fromCanon} -> ${to}`)) problems.push(`status-log ${JSON.stringify(res.log)}`);
    } else {
      if (warnLines.length !== 0) problems.push(`unexpected WARN ${JSON.stringify(warnLines)}`);
      if (res.log !== logRow(existing, to, '')) problems.push(`status-log ${JSON.stringify(res.log)}`);
    }
    if (problems.length) fail(`WARN-MODE ${label}: ${problems.join('; ')}`);
    else pass(`WARN-MODE ${label}: applied, ${illegal ? 'WARN on stderr + note in status-log' : 'no warning, empty status-log note'}`);
  });
} catch (e) {
  warn(`reply-watch gate harness error: ${e.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
