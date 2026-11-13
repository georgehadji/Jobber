// tests/openrouter-pipeline-e2e.test.mjs — cmdPipeline end to end (STATE-MACHINES-PLAN D11 follow-up).
// The runner has a test seam: a fake evaluator, a temp pipeline file and no rate-limit pause. The REAL
// pipeline-inbox writers (lock + atomic write) run against the temp file, so this pins what a user's
// data/pipeline.md looks like after a run:
//   success -> moved to Processed with its report number; throw -> `[!]` with the message;
//   null report -> `[!]` with the generic retry reason; the loop keeps going after a failure.
import { pass, fail } from './helpers.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { cmdPipeline } from '../openrouter-runner.mjs';

console.log('\nopenrouter-runner cmdPipeline: end to end with a fake evaluator');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const U = (n) => `https://jobs.example/${n}`;
const work = mkdtempSync(join(tmpdir(), 'or-pipeline-'));
const quiet = async (fn) => { // cmdPipeline logs progress; keep the test output readable
  const log = console.log, err = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = err; }
};
let n = 0;
const fileWith = (text) => { const f = join(work, `pipeline-${n++}.md`); writeFileSync(f, text); return f; };
const rowsOf = (text, marker) => text.split('\n').filter((l) => l.startsWith(`- [${marker}]`));

try {
  const f = fileWith(`# Pipeline\n\n## Pending\n\n- [ ] ${U('a')} | Acme | Engineer\n- [ ] ${U('b')} | Beta | Analyst\n- [ ] ${U('c')} | Gamma | Lead\n- [ ] ${U('d')} | Delta | Designer\n\n## Processed\n\n`);
  const calls = [];
  const evaluate = async (url) => {
    calls.push(url);
    if (url === U('a')) return 'reports/012-acme-2026-01-01.md';
    if (url === U('b')) throw new Error('HTTP 403 forbidden');
    if (url === U('c')) return null;
    return 'reports/013-delta-2026-01-01.md';
  };
  await quiet(() => cmdPipeline({}, { evaluate, pipelinePath: f, delayMs: 0 }));
  const out = readFileSync(f, 'utf8');
  eq('every pending row is evaluated, in order, and the loop continues after a failure', calls, [U('a'), U('b'), U('c'), U('d')]);
  eq('no row is left pending', rowsOf(out, ' ').length, 0);
  eq('successes move to Processed with their report number', rowsOf(out, 'x').map((l) => l.split(' | ').slice(0, 2).join(' | ')).sort(), [`- [x] #012 | ${U('a')}`, `- [x] #013 | ${U('d')}`]);
  const errs = rowsOf(out, '!');
  eq('a throw is marked [!] with its own message', errs.find((l) => l.includes(U('b'))).endsWith('— Error: HTTP 403 forbidden'), true);
  eq('a null report is marked [!] with the generic retry reason (D11)', /— Error: evaluation produced no report .*re-queue as - \[ \] to retry$/.test(errs.find((l) => l.includes(U('c')))), true);
  eq('exactly the two failed rows are [!]', errs.length, 2);
  eq('the failed rows stay in the Pending section (re-queueable by hand)', out.indexOf(U('b')) < out.indexOf('## Processed') && out.indexOf(U('c')) < out.indexOf('## Processed'), true);

  // control: an all-success run produces no [!] row, so the [!] above is caused by the failures
  const g = fileWith(`# Pipeline\n\n## Pending\n\n- [ ] ${U('e')} | Echo | PM\n\n## Processed\n\n`);
  await quiet(() => cmdPipeline({}, { evaluate: async () => 'reports/020-echo-2026-01-01.md', pipelinePath: g, delayMs: 0 }));
  const gOut = readFileSync(g, 'utf8');
  eq('control: an all-success run has no [!] row and moves the row to Processed', [rowsOf(gOut, '!').length, rowsOf(gOut, 'x').length, rowsOf(gOut, ' ').length], [0, 1, 0]);

  // control: nothing pending -> the evaluator is never called and the file is untouched
  const h = fileWith('# Pipeline\n\n## Pending\n\n## Processed\n\n');
  let called = 0;
  await quiet(() => cmdPipeline({}, { evaluate: async () => { called++; return null; }, pipelinePath: h, delayMs: 0 }));
  eq('control: an empty inbox calls nothing and rewrites nothing', [called, readFileSync(h, 'utf8')], [0, '# Pipeline\n\n## Pending\n\n## Processed\n\n']);

  // control: a missing pipeline file is the same "nothing pending" path (matches the old readFile -> '' behaviour)
  let calledMissing = 0;
  await quiet(() => cmdPipeline({}, { evaluate: async () => { calledMissing++; return null; }, pipelinePath: join(work, 'absent.md'), delayMs: 0 }));
  eq('control: a missing pipeline file means nothing pending, not a crash', calledMissing, 0);
} catch (e) {
  fail(`cmdPipeline end-to-end threw: ${e.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
