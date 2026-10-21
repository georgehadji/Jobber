// tests/merge-tracker-batch.test.mjs — Workstream E of docs/AUDIT-FIX-PLAN.md.
// Several TSVs for the same role in one batch, re-eval notes, unmerged TSVs staying
// put, and --migrate-via keeping the last cell. Each scenario runs the real script
// against a temp tracker (JOBBER_TRACKER / JOBBER_ADDITIONS).
import { pass, fail, warn, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

console.log('\nmerge-tracker batch semantics (audit workstream E)');

const HEADER =
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|-------|\n';

function eq(label, got, want) {
  if (got === want) pass(label);
  else fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/** Build a sandbox; returns null (after warn) if it cannot be built. */
function sandbox(trackerBody, tsvs) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-batch-'));
  try {
    mkdirSync(join(dir, 'data'));
    mkdirSync(join(dir, 'reports'));
    const additions = join(dir, 'additions');
    mkdirSync(additions);
    const tracker = join(dir, 'data', 'applications.md');
    writeFileSync(tracker, trackerBody);
    for (const [name, body] of Object.entries(tsvs)) writeFileSync(join(additions, name), body);
    return { dir, tracker, additions };
  } catch (e) {
    warn(`merge fixture could not be built: ${e.message}`);
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
}

function merge(sb, args = []) {
  return spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, JOBBER_TRACKER: sb.tracker, JOBBER_ADDITIONS: sb.additions },
  });
}

const tsv = (num, company, role, score, note) =>
  `${num}\t2026-02-0${num}\t${company}\t${role}\tEvaluated\t${score}/5\t❌\t[${num}](reports/00${num}-x-2026-02-0${num}.md)\t${note}\n`;
const rowsOf = (file) => readFileSync(file, 'utf8').split('\n').filter((l) => /^\| \d+ \|/.test(l));

// ── A/C: two re-evals of one existing row in one batch; old notes survive ──
{
  const sb = sandbox(
    HEADER + '| 1 | 2026-01-01 | Acme | Platform Engineer | 3.0/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-01-01.md) | orig note |\n',
    {
      '002-acme.tsv': tsv(2, 'Acme', 'Platform Engineer', '4.0', 'first re-eval'),
      '003-acme.tsv': tsv(3, 'Acme', 'Platform Engineer', '4.5', 'second re-eval'),
    },
  );
  if (sb) {
    const r = merge(sb);
    const rows = rowsOf(sb.tracker);
    if (r.status !== 0) fail(`merge exited ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
    else {
      eq('two re-evals of one row leave one Acme row', rows.length, 1);
      eq('the second re-eval is not dropped: final score is 4.5', /\| 4\.5\/5 \|/.test(rows[0] || ''), true);
      eq('the final row carries the newest note', (rows[0] || '').includes('second re-eval'), true);
    }
    rmSync(sb.dir, { recursive: true, force: true });
  }
  const sb2 = sandbox(
    HEADER + '| 1 | 2026-01-01 | Acme | Platform Engineer | 3.0/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-01-01.md) | orig note |\n',
    { '002-acme.tsv': tsv(2, 'Acme', 'Platform Engineer', '4.0', 'first re-eval') },
  );
  if (sb2) {
    merge(sb2);
    const row = rowsOf(sb2.tracker)[0] || '';
    eq('a re-eval keeps the row\'s previous notes', row.includes('orig note') && row.includes('first re-eval'), true);
    rmSync(sb2.dir, { recursive: true, force: true });
  }
}

// ── B: two TSVs for one NEW role insert it once, with the better score ──
{
  const sb = sandbox(HEADER, {
    '002-newco.tsv': tsv(2, 'NewCo', 'Data Engineer', '4.0', 'draft'),
    '003-newco.tsv': tsv(3, 'NewCo', 'Data Engineer', '4.2', 'rescored'),
  });
  if (sb) {
    const r = merge(sb);
    const rows = rowsOf(sb.tracker).filter((l) => l.includes('NewCo'));
    if (r.status !== 0) fail(`merge exited ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
    else {
      eq('two TSVs for one new role insert one row', rows.length, 1);
      eq('the inserted row has the higher score', /\| 4\.2\/5 \|/.test(rows[0] || ''), true);
    }
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── D: malformed TSVs stay put, merged ones are archived ────────────────
{
  const sb = sandbox(HEADER, {
    '002-good.tsv': tsv(2, 'GoodCo', 'Designer', '4.0', 'fine'),
    '003-bad.tsv': 'this is not a tracker addition\n',
  });
  if (sb) {
    merge(sb);
    eq('control: the good TSV left the additions dir', existsSync(join(sb.additions, '002-good.tsv')), false);
    eq('the malformed TSV is still in the additions dir', existsSync(join(sb.additions, '003-bad.tsv')), true);
    eq('the malformed TSV was not archived to merged/', readdirSync(join(sb.additions, 'merged')).includes('003-bad.tsv'), false);
    eq('the good row was merged', rowsOf(sb.tracker).some((l) => l.includes('GoodCo')), true);
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── E: --migrate-via keeps the Notes of a row written without a closing pipe ──
{
  const sb = sandbox(
    HEADER + '| 1 | 2026-01-01 | Acme | Platform Engineer | 3.0/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-01-01.md) | keep this note |\n' +
      '| 2 | 2026-01-02 | Beta | Designer | 3.5/5 | Evaluated | ❌ | [2](../reports/002-beta-2026-01-02.md) | no closing pipe\n',
    {},
  );
  if (sb) {
    const r = merge(sb, ['--migrate-via']);
    const body = readFileSync(sb.tracker, 'utf8');
    if (r.status !== 0) fail(`--migrate-via exited ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
    else {
      eq('control: a row with a closing pipe keeps its note', body.includes('keep this note'), true);
      eq('a row without a closing pipe keeps its last cell', body.includes('no closing pipe'), true);
    }
    rmSync(sb.dir, { recursive: true, force: true });
  }
}
