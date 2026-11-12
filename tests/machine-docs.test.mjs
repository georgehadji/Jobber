// tests/machine-docs.test.mjs — generated state-machine blocks in Markdown
// (STATE-MACHINES-PLAN Phase 4.4): gen-machine-docs.mjs, lib/machine-blocks.mjs, and the
// translation-freshness handling of generated regions. Also the in-suite staleness gate:
// the checked-in docs must pass `gen-machine-docs.mjs --check`.
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadMachine, describe } from '../lib/state-machine.mjs';
import { findBlocks, renderBlock, stripMachineBlocks, MarkerError } from '../lib/machine-blocks.mjs';

console.log('\ngenerated state-machine blocks (gen-machine-docs)');

const GEN = join(ROOT, 'gen-machine-docs.mjs');
const run = (args, cwd = ROOT) => spawnSync(NODE, [GEN, ...args], { encoding: 'utf-8', timeout: 60_000, cwd });
const d = describe(loadMachine('application-status'));
const mk = (view, kind) => `<!-- machine:application-status${view ? `:${view}` : ''} ${kind} -->`;

// ── 1. The checked-in docs ─────────────────────────────────────────
const DOCS = ['AGENTS.md', 'modes/tracker.md', 'modes/patterns.md', 'modes/outcome.md', 'modes/followup.md', 'modes/reply-watch.md'];
{
  const r = run(['--check']);
  if (r.error || r.status === null) warn('gen-machine-docs --check could not be run — not verified');
  else if (r.status === 0) pass('checked-in docs: gen-machine-docs --check is clean (a stale block fails the suite)');
  else fail(`checked-in docs have stale or broken machine blocks (exit ${r.status}): ${r.stderr.trim().split('\n')[0]} — run: node gen-machine-docs.mjs`);

  const labels = d.states.map(s => s.label);
  for (const f of DOCS) {
    const text = readFileSync(join(ROOT, f), 'utf-8');
    let blocks;
    try { blocks = findBlocks(text); } catch (e) { fail(`${f}: ${e.message}`); continue; }
    if (blocks.length === 0) { fail(`${f}: no machine blocks (the six English docs must carry one)`); continue; }
    // Identity, not count: every state label must appear inside this file's generated blocks.
    const body = blocks.map(b => text.slice(b.bodyStart, b.bodyEnd)).join('\n');
    // patterns.md's `later` view lists the states AFTER the initial one on purpose ("beyond Evaluated").
    const want = f === 'modes/patterns.md' ? labels.filter(l => l !== d.states.find(s => s.id === d.initial).label) : labels;
    const missing = want.filter(l => !body.includes(l));
    if (missing.length) fail(`${f}: generated blocks omit state(s) ${missing.join(', ')}`);
    else pass(`${f}: ${blocks.length} generated block(s) name all ${want.length} expected states`);
  }
}

// ── 2. Block content equals describe() output (independent formatting) ──
{
  const tick = s => `\`${s}\``;
  const eolWrap = lines => '\n' + lines.join('\n') + '\n';
  const wantTable = eolWrap(['| State | When to use |', '|-------|-------------|',
    ...d.states.map(s => `| ${tick(s.label)} | ${s.description}${s.terminal ? ' (terminal)' : ''} |`)]);
  const wantList = eolWrap(d.states.map(s => `- ${tick(s.label)} = ${s.description}${s.terminal ? ' (terminal)' : ''}`));
  const wantInline = '`Evaluated` → `Applied` → `Responded` → `Interview` → `Offer` → `Hired` / `Rejected` / `Discarded` / `SKIP`';
  const wantLater = 'Applied, Responded, Interview, Offer, Rejected, Discarded, SKIP, Hired';
  const eq = (name, got, want) => got === want ? pass(`view ${name} equals the describe()-derived text`) : fail(`view ${name} differs:\n--- got\n${got}\n--- want\n${want}`);
  eq('table', renderBlock(d, 'table'), wantTable);
  eq('list', renderBlock(d, 'list'), wantList);
  eq('inline', renderBlock(d, 'inline'), wantInline);
  eq('later', renderBlock(d, 'later'), wantLater);
  // CRLF variant of a block view uses CRLF between lines.
  const crlf = renderBlock(d, 'list', '\r\n');
  /(?<!\r)\n/.test(crlf) ? fail('CRLF-rendered block contains a bare LF') : pass('CRLF-rendered block uses CRLF throughout');
  try { renderBlock(d, 'nope'); fail('unknown view was accepted'); } catch (e) { e instanceof MarkerError && /Known views/.test(e.message) ? pass('unknown view is refused and the known views are named') : fail(`unknown view: wrong error ${e.message}`); }
}

// ── 3. CLI behaviour on a temp root ────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'machine-docs-'));
try {
  let fixtureOk = true;
  try {
    mkdirSync(join(tmp, 'templates'), { recursive: true });
    mkdirSync(join(tmp, 'modes'), { recursive: true });
    copyFileSync(join(ROOT, 'templates', 'states.yml'), join(tmp, 'templates', 'states.yml'));
  } catch (e) { fixtureOk = false; warn(`temp root could not be built (${e.message}) — CLI behaviour not verified`); }

  if (fixtureOk) {
    const doc = join(tmp, 'doc.md');
    const wrap = eol => [
      '# Title — outside text 1 (ünïcode, trailing spaces)  ', '',
      `Lifecycle: ${mk('inline', 'begin')}STALE${mk('inline', 'end')} done.`, '',
      mk('table', 'begin'), 'old table row', mk('table', 'end'), '',
      mk('', 'begin'), mk('', 'end'),
      'Tail text with <!-- an ordinary comment --> and `code`.', '',
    ].join(eol);
    const outsideOf = text => stripMachineBlocks(text);  // markers kept, bodies emptied

    // stale -> detected without writing
    writeFileSync(doc, wrap('\n'));
    const before = readFileSync(doc);
    const chk = run(['--check', '--root', tmp, 'doc.md']);
    const named = /stale: doc\.md:\d+ machine:application-status:inline/.test(chk.stderr) && /machine:application-status:table/.test(chk.stderr);
    chk.status === 1 && named ? pass('--check exits 1 and names the file and each stale block') : fail(`--check on stale doc: exit ${chk.status}, stderr ${JSON.stringify(chk.stderr)}`);
    Buffer.compare(before, readFileSync(doc)) === 0 ? pass('--check never writes') : fail('--check modified the file');

    // default run rewrites; then fresh; idempotent
    const gen = run(['--root', tmp, 'doc.md']);
    const after = readFileSync(doc, 'utf-8');
    gen.status === 0 && after !== before.toString() ? pass('default run rewrites stale blocks') : fail(`default run: exit ${gen.status}, changed=${after !== before.toString()}`);
    const chk2 = run(['--check', '--root', tmp, 'doc.md']);
    chk2.status === 0 ? pass('--check passes on a fresh file (control)') : fail(`--check on fresh file: exit ${chk2.status} ${chk2.stderr}`);
    run(['--root', tmp, 'doc.md']);
    readFileSync(doc, 'utf-8') === after ? pass('generation is idempotent') : fail('second generation changed the file');
    // The generated blocks hold the describe()-derived text
    const blocks = findBlocks(after);
    const bodies = blocks.map(b => after.slice(b.bodyStart, b.bodyEnd));
    bodies[0] === renderBlock(d, 'inline') && bodies[1] === renderBlock(d, 'table') && bodies[2] === renderBlock(d, 'list')
      ? pass('written blocks equal renderBlock(describe()) (default view = list)') : fail('written blocks differ from renderBlock output');

    // text outside the markers is byte-identical
    outsideOf(after) === outsideOf(wrap('\n')) ? pass('text outside the markers is unchanged by generation') : fail('generation altered text outside the markers');
    // Control: the comparison can fail — a change outside a marker is visible to the same check.
    outsideOf(after.replace('Tail text', 'Tail TEXT')) !== outsideOf(wrap('\n')) ? pass('control: an edit outside the markers is detected by the same comparison') : fail('control failed: outside-text comparison is blind');

    // registry change makes a previously fresh doc stale (control for the staleness path)
    const yml = join(tmp, 'templates', 'states.yml');
    const ymlOrig = readFileSync(yml, 'utf-8');
    writeFileSync(yml, ymlOrig.replace('Application submitted', 'Application sent in'));
    const chk3 = run(['--check', '--root', tmp, 'doc.md']);
    chk3.status === 1 && /machine:application-status:(table|list)/.test(chk3.stderr) ? pass('a registry change makes the blocks stale (--check exits 1)') : fail(`registry edit not detected: exit ${chk3.status} ${chk3.stderr}`);
    writeFileSync(yml, ymlOrig);

    // CRLF preserved
    writeFileSync(doc, wrap('\r\n'));
    run(['--root', tmp, 'doc.md']);
    const crlfOut = readFileSync(doc, 'utf-8');
    const bareLf = /(?<!\r)\n/.test(crlfOut);
    !bareLf && crlfOut.includes('\r\n') ? pass('CRLF file keeps CRLF line endings after generation') : fail('CRLF file gained bare LF line endings');
    outsideOf(crlfOut) === outsideOf(wrap('\r\n')).replace(/\r\n/g, '\n') ? pass('CRLF file: outside text unchanged') : fail('CRLF file: outside text changed');
    writeFileSync(doc, wrap('\n'));
    run(['--root', tmp, 'doc.md']);
    readFileSync(doc, 'utf-8').includes('\r') ? fail('LF file gained CR characters') : pass('LF file stays LF (control)');

    // marker errors: exit 2, message names the problem, file untouched
    const bad = {
      'end without begin': [`text\n${mk('list', 'end')}\n`, /no matching begin/],
      'begin never closed': [`text\n${mk('list', 'begin')}\nx\n`, /never closed/],
      'nested begin': [`${mk('list', 'begin')}\n${mk('table', 'begin')}\n${mk('table', 'end')}\n${mk('list', 'end')}\n`, /inside the still-open block/],
      'mismatched end': [`${mk('list', 'begin')}\n${mk('table', 'end')}\n`, /closes the block/],
      'unknown machine': ['<!-- machine:no-such-machine:list begin -->\n<!-- machine:no-such-machine:list end -->\n', /Unknown state machine "no-such-machine"/],
      'unknown view': [`${mk('sparkle', 'begin')}\n${mk('sparkle', 'end')}\n`, /Unknown view "sparkle"/],
      'malformed marker': ['<!-- machine:application-status:list start -->\n', /Malformed machine marker/],
    };
    for (const [name, [content, re]] of Object.entries(bad)) {
      writeFileSync(doc, content);
      const r = run(['--root', tmp, 'doc.md']);
      const rc = run(['--check', '--root', tmp, 'doc.md']);
      const untouched = readFileSync(doc, 'utf-8') === content;
      r.status === 2 && rc.status === 2 && re.test(r.stderr) && /doc\.md/.test(r.stderr) && untouched
        ? pass(`${name}: refused with exit 2, file named, nothing written`)
        : fail(`${name}: exit ${r.status}/${rc.status}, untouched=${untouched}, stderr ${JSON.stringify(r.stderr)}`);
    }
    // Control: a balanced doc with the same machinery is accepted (errors are not blanket).
    writeFileSync(doc, `${mk('list', 'begin')}\n${mk('list', 'end')}\n`);
    run(['--root', tmp, 'doc.md']).status === 0 ? pass('balanced markers are accepted (control)') : fail('balanced markers were refused');

    // Default scan picks up modes/*.md and ignores files without markers
    writeFileSync(join(tmp, 'modes', 'a.md'), `no markers here\n`);
    writeFileSync(join(tmp, 'modes', 'b.md'), `${mk('inline', 'begin')}x${mk('inline', 'end')}\n`);
    rmSync(doc);
    const scan = run(['--check', '--root', tmp]);
    scan.status === 1 && /modes\/b\.md/.test(scan.stderr) && !/modes\/a\.md/.test(scan.stderr)
      ? pass('default scan covers modes/*.md and skips marker-free files') : fail(`default scan: exit ${scan.status} ${scan.stderr}`);
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

// ── 4. Translation freshness ignores generated regions ─────────────
{
  const repo = mkdtempSync(join(tmpdir(), 'machine-fresh-'));
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], { cwd: repo, encoding: 'utf-8' });
  try {
    let ok = true;
    try {
      mkdirSync(join(repo, 'lib'), { recursive: true });
      mkdirSync(join(repo, 'modes', 'xx'), { recursive: true });
      copyFileSync(join(ROOT, 'check-translation-freshness.mjs'), join(repo, 'check-translation-freshness.mjs'));
      copyFileSync(join(ROOT, 'lib', 'machine-blocks.mjs'), join(repo, 'lib', 'machine-blocks.mjs'));
      ok = git('init', '-q').status === 0;
    } catch { ok = false; }
    if (!ok) warn('temp git repo could not be built — translation-freshness handling not verified');
    else {
      const src = (prose, body, plain) => `# Mode\n${prose}\n${mk('list', 'begin')}\n${body}\n${mk('list', 'end')}\n`;
      const write = (f, c) => writeFileSync(join(repo, f), c);
      const commit = m => { git('add', '-A'); return git('commit', '-q', '-m', m); };
      const stamp = sha => `<!-- jobber-source-sha: ${sha} -->\n# Modo\ntexto\n`;
      write('modes/t.md', src('prose v1', 'body v1'));
      write('modes/plain.md', '# Plain\nv1\n');
      const c1 = commit('source v1');
      const sha1 = git('rev-parse', 'HEAD').stdout.trim();
      write('modes/xx/t.md', stamp(sha1));
      write('modes/xx/plain.md', stamp(sha1));
      const c2 = commit('translations');
      const report = () => {
        const r = spawnSync(NODE, [join(repo, 'check-translation-freshness.mjs')], { cwd: repo, encoding: 'utf-8', timeout: 60_000 });
        try { return JSON.parse(r.stdout).modeTranslations.map(f => f.file).sort(); } catch { return null; }
      };
      if (c1.status !== 0 || c2.status !== 0) warn(`temp repo commits failed (${c1.stderr}${c2.stderr}) — translation-freshness handling not verified`);
      else {
        const base = report();
        base && base.length === 0 ? pass('freshness baseline: stamped translations are fresh') : fail(`freshness baseline: ${JSON.stringify(base)}`);

        write('modes/t.md', src('prose v1', 'body v2 REGENERATED'));
        commit('regenerate block only');
        const afterBlock = report();
        afterBlock && !afterBlock.includes('modes/xx/t.md') ? pass('regenerating a block does not flag the translation stale') : fail(`block-only change flagged: ${JSON.stringify(afterBlock)}`);

        // Control: a change outside the block still flags (same file, same machinery).
        write('modes/t.md', src('prose v2 EDITED', 'body v2 REGENERATED'));
        commit('edit prose');
        const afterProse = report();
        afterProse && afterProse.includes('modes/xx/t.md') ? pass('control: a prose change outside the block still flags the translation') : fail(`prose change not flagged: ${JSON.stringify(afterProse)}`);

        // Control: a marker-free file keeps the original behaviour (any change flags).
        write('modes/plain.md', '# Plain\nv2\n');
        commit('edit plain');
        const afterPlain = report();
        afterPlain && afterPlain.includes('modes/xx/plain.md') ? pass('control: marker-free source change flags as before') : fail(`marker-free change not flagged: ${JSON.stringify(afterPlain)}`);
      }
    }
  } finally { rmSync(repo, { recursive: true, force: true }); }
}
