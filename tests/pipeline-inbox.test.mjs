// tests/pipeline-inbox.test.mjs — lib/pipeline-inbox.mjs: the single locked,
// atomic reader/writer for data/pipeline.md (STATE-MACHINES-PLAN M7, Phase 3.6).
//
// Properties pinned, each with a control (see AGENTS.md "Writing Assertions"):
//   1. The parser reads BOTH `[x]` encodings plus `[ ]` and `[!]` (control: the
//      two `[x]` forms are told apart, `[ ]` is not `[x]`).
//   2. markProcessed / markError change exactly the target row (control: the
//      other lines are byte-identical, a missing URL changes nothing, an exact
//      URL match does not hit a URL that merely shares its prefix).
//   3. Concurrent writers lose nothing (control: the old unlocked
//      read-modify-write recipe, run the same way, DOES lose rows).
//   4. The atomic write leaves no tmp file behind.
// Temp dirs only — never the real data/. A fixture that cannot be built is a
// warn(), not a pass.
import { pass, fail, warn, ROOT } from './helpers.mjs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs';

const LIB_URL = pathToFileURL(join(ROOT, 'lib', 'pipeline-inbox.mjs')).href;
const { parseInbox, markProcessed, markError, appendPending } = await import(LIB_URL);

console.log('\nlib/pipeline-inbox.mjs — tolerant parser, single-row writers, locked atomic writes');

let root = null;
try {
  root = mkdtempSync(join(tmpdir(), 'jobber-pipeline-inbox-'));
  mkdirSync(join(root, 'data'), { recursive: true });
} catch (e) {
  warn(`pipeline-inbox tests skipped: could not build temp dir (${e.message})`);
}

const SAMPLE = [
  '# Pipeline',
  '',
  '## Pending',
  '- [ ] https://a.example/jobs/1 | Acme | Engineer',
  '- [ ] https://a.example/jobs/12 | Acme | Engineer II',
  '- [ ] https://b.example/jobs/2',
  '- [x] https://c.example/jobs/3 | Cee | Flipped in place',
  '- [!] https://d.example/jobs/4 — Error: login required',
  '',
  '## Processed',
  '- [x] #143 | https://e.example/jobs/5 | Eee | AI PM | 4.2/5 | PDF ✅',
  '- [x] ~~https://f.example/jobs/6 | Eff | Gone~~ — posting expired (liveness sweep)',
  '',
].join('\n');

if (root) {
  // ── 1. parser ────────────────────────────────────────────────────────────
  try {
    const rows = parseInbox(SAMPLE);
    const by = (u) => rows.find((r) => r.url === u);
    const ok =
      rows.length === 7 &&
      by('https://a.example/jobs/1')?.state === 'pending' &&
      by('https://b.example/jobs/2')?.state === 'pending' &&
      by('https://c.example/jobs/3')?.state === 'processed' &&
      by('https://c.example/jobs/3')?.encoding === 'in-place' &&
      by('https://e.example/jobs/5')?.state === 'processed' &&
      by('https://e.example/jobs/5')?.encoding === 'moved' &&
      by('https://f.example/jobs/6')?.encoding === 'moved' &&
      by('https://d.example/jobs/4')?.state === 'error';
    if (ok) pass('parseInbox reads [ ], [!], and both [x] encodings (moved vs in-place told apart)');
    else fail(`parseInbox mis-parsed: ${JSON.stringify(rows.map((r) => [r.url, r.state, r.encoding]))}`);

    const crlf = parseInbox(SAMPLE.replace(/\n/g, '\r\n'));
    if (crlf.length === 7 && crlf.every((r, i) => r.state === rows[i].state && r.url === rows[i].url)) pass('parseInbox is CRLF-tolerant');
    else fail('parseInbox differs on a CRLF copy of the same file');
  } catch (e) {
    fail(`parseInbox threw: ${e.message}`);
  }

  // ── 2. single-row writers ────────────────────────────────────────────────
  try {
    const file = join(root, 'data', 'one.md');
    writeFileSync(file, SAMPLE);
    const before = SAMPLE.split('\n');

    const r = await markProcessed(file, 'https://a.example/jobs/1', { ref: '#7', score: '4.1/5', pdf: true });
    const after = readFileSync(file, 'utf-8').split('\n');
    const gone = before.filter((l) => !after.includes(l));
    const added = after.filter((l) => !before.includes(l));
    if (r.changed && gone.length === 1 && gone[0] === before[3] &&
        added.length === 1 && added[0] === '- [x] #7 | https://a.example/jobs/1 | Acme | Engineer | 4.1/5 | PDF ✅') {
      pass('markProcessed removes exactly the target row and adds exactly one Processed row');
    } else fail(`markProcessed diff wrong: gone=${JSON.stringify(gone)} added=${JSON.stringify(added)}`);

    const procIdx = after.findIndex((l) => l === '## Processed');
    const newIdx = after.indexOf(added[0]);
    const untouched = before.filter((l) => l !== before[3]);
    const rest = after.filter((l) => l !== added[0]);
    if (newIdx > procIdx && JSON.stringify(untouched) === JSON.stringify(rest)) pass('markProcessed: new row sits under ## Processed and every other line is byte-identical and in order');
    else fail('markProcessed disturbed other lines or placed the row outside Processed');

    // control: a URL that only shares a prefix with another row must not match it
    const sibling = after.find((l) => l.includes('/jobs/12'));
    if (sibling && sibling.startsWith('- [ ] ')) pass('control: /jobs/12 row untouched when /jobs/1 was marked (exact URL match, no prefix bleed)');
    else fail('prefix URL bled into a sibling row');

    // control: unknown URL -> no change at all
    const snap = readFileSync(file, 'utf-8');
    const miss = await markProcessed(file, 'https://nope.example/x', {});
    if (!miss.changed && readFileSync(file, 'utf-8') === snap) pass('markProcessed on an unknown URL is a no-op');
    else fail('markProcessed on an unknown URL changed the file');

    // markError: in place, reason kept, single line, nothing else changes
    const before2 = readFileSync(file, 'utf-8').split('\n');
    const er = await markError(file, 'https://b.example/jobs/2', 'HTTP 403\nforbidden | blocked');
    const after2 = readFileSync(file, 'utf-8').split('\n');
    const diff = after2.map((l, i) => [l, before2[i]]).filter(([a, b]) => a !== b);
    if (er.changed && after2.length === before2.length && diff.length === 1 &&
        diff[0][0] === '- [!] https://b.example/jobs/2 — Error: HTTP 403 forbidden blocked') {
      pass('markError flips one row to [!] in place with a one-line reason');
    } else fail(`markError diff wrong: ${JSON.stringify(diff)}`);
    // control: an already-[!] / [x] row is not re-marked
    const again = await markError(file, 'https://d.example/jobs/4', 'again');
    if (!again.changed) pass('markError leaves an existing [!] row alone');
    else fail('markError re-marked a non-pending row');

    // CRLF file stays CRLF, untouched lines keep their bytes
    const crlfFile = join(root, 'data', 'crlf.md');
    const crlfText = SAMPLE.replace(/\n/g, '\r\n');
    writeFileSync(crlfFile, crlfText);
    await markProcessed(crlfFile, 'https://b.example/jobs/2', { ref: '#9' });
    const crlfAfter = readFileSync(crlfFile, 'utf-8');
    if (!/[^\r]\n/.test(crlfAfter) && crlfAfter.includes('- [x] #9 | https://b.example/jobs/2')) pass('markProcessed keeps a CRLF file CRLF');
    else fail('markProcessed introduced bare LF into a CRLF file');

    // appendPending: lands in Pending, before the next section, rest identical
    const apFile = join(root, 'data', 'ap.md');
    writeFileSync(apFile, SAMPLE);
    await appendPending(apFile, ['- [ ] https://new.example/1 | N | Role']);
    const apAfter = readFileSync(apFile, 'utf-8').split('\n');
    const nIdx = apAfter.indexOf('- [ ] https://new.example/1 | N | Role');
    const pIdx = apAfter.indexOf('## Processed');
    // Same blank-line shape scan.mjs always produced (one extra blank around the block): compare content lines.
    const content = (ls) => JSON.stringify(ls.filter((l) => l !== '' && l !== '- [ ] https://new.example/1 | N | Role'));
    if (nIdx > 0 && nIdx < pIdx && apAfter[nIdx - 2] === before[7] && content(apAfter) === content(before)) pass('appendPending adds one row at the end of Pending; every existing line unchanged and in order');
    else fail('appendPending misplaced the row or disturbed other lines');
  } catch (e) {
    fail(`single-row writer tests threw: ${e.message}`);
  }

  // ── 3. concurrency ───────────────────────────────────────────────────────
  // Workers are separate processes. 'locked' uses the helper; 'naive' is the
  // old recipe (read whole file, modify, write) with no lock.
  let workerFile = null;
  try {
    workerFile = join(root, 'worker.mjs');
    writeFileSync(workerFile, `
import { appendPending, markProcessed } from ${JSON.stringify(LIB_URL)};
import { readFileSync, writeFileSync } from 'fs';
const [, , mode, file, tag, n] = process.argv;
const N = Number(n);
for (let i = 0; i < N; i++) {
  const url = 'https://' + tag + '.example/job/' + i;
  if (mode === 'locked') {
    await appendPending(file, ['- [ ] ' + url + ' | Co | Role']);
    if (i % 3 === 0) await markProcessed(file, url, { ref: '#' + i });
  } else {
    const t = readFileSync(file, 'utf-8');
    await new Promise((r) => setTimeout(r, 1));
    writeFileSync(file, t.replace('## Processed', '- [ ] ' + url + ' | Co | Role\\n\\n## Processed'));
  }
}
`);
  } catch (e) {
    warn(`concurrency tests skipped: could not write worker (${e.message})`);
    workerFile = null;
  }

  const runPair = (mode, file, n) => Promise.all(['p', 'q'].map((tag) => new Promise((resolve) => {
    const child = spawn(process.execPath, [workerFile, mode, file, tag, String(n)], {
      env: { ...process.env, JOBBER_PIPELINE_LOCK_TIMEOUT_MS: '120000' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, err }));
  })));
  const missing = (file, n) => {
    const text = readFileSync(file, 'utf-8');
    const lost = [];
    for (const tag of ['p', 'q']) for (let i = 0; i < n; i++) {
      if (!text.includes(`https://${tag}.example/job/${i} `)) lost.push(`${tag}${i}`);
    }
    return lost;
  };

  if (workerFile) {
    const N = 25;
    try {
      const lockedFile = join(root, 'data', 'locked.md');
      const naiveFile = join(root, 'data', 'naive.md');
      writeFileSync(lockedFile, '# Pipeline\n\n## Pending\n\n## Processed\n');
      writeFileSync(naiveFile, '# Pipeline\n\n## Pending\n\n## Processed\n');

      const res = await runPair('locked', lockedFile, N);
      const bad = res.filter((r) => r.code !== 0);
      if (bad.length) fail(`locked worker exited non-zero: ${bad.map((b) => b.err.slice(0, 200)).join(' / ')}`);
      else {
        const lost = missing(lockedFile, N);
        if (lost.length === 0) pass(`two concurrent processes x${N} appends+marks: no row lost (${2 * N} rows present)`);
        else fail(`locked writers lost ${lost.length} row(s): ${lost.slice(0, 8).join(',')}`);
        // identity, not count: every third row was moved, the rest still pending
        const rows = parseInbox(readFileSync(lockedFile, 'utf-8'));
        const wrongState = rows.filter((r) => {
          const m = r.url.match(/job\/(\d+)$/);
          return m && (Number(m[1]) % 3 === 0) !== (r.state === 'processed');
        });
        if (wrongState.length === 0) pass('concurrent marks landed on the right rows (processed iff index % 3 == 0)');
        else fail(`wrong state on ${wrongState.length} row(s), e.g. ${wrongState[0].url} -> ${wrongState[0].state}`);
      }

      // control: the unlocked recipe must lose rows, or this test cannot detect loss
      await runPair('naive', naiveFile, N);
      const naiveLost = missing(naiveFile, N);
      if (naiveLost.length > 0) pass(`control: the old unlocked read-modify-write lost ${naiveLost.length} row(s) under the same load`);
      else warn('control inconclusive: unlocked writers happened not to collide this run (timing-dependent)');
    } catch (e) {
      warn(`concurrency test could not complete: ${e.message}`);
    }
  }

  // ── 4. no tmp residue ────────────────────────────────────────────────────
  try {
    const leftovers = readdirSync(join(root, 'data')).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock'));
    if (leftovers.length === 0) pass('atomic writes leave no .tmp file and no stale .lock dir behind');
    else fail(`leftovers in data/: ${leftovers.join(', ')}`);
  } catch (e) {
    warn(`tmp-residue check skipped: ${e.message}`);
  }

  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}
