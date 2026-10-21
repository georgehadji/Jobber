// tests/add-entry-write.test.mjs — add-entry.mjs write path (audit finding 19).
// The CV is the user's own file: only the edited section may change, the write must
// be atomic, and two concurrent adds must both land.
import { pass, fail, warn, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn, spawnSync } from 'child_process';

console.log('\nadd-entry.mjs — write path (audit workstream E)');

function eq(label, got, want) {
  if (got === want) pass(label);
  else fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const CV = [
  '# Jane Doe', '', '',
  '## Summary', '', 'Short summary.', '', '', '',
  '## Projects', '', '- **Old** (OSS) -- first project', '', '',
  '## Education', '', '', '- BSc, Somewhere', '',
].join('\n');

const payload = (name) => JSON.stringify({ cv: { section: 'Projects', dedupKey: name, entry: `- **${name}** (OSS) -- added by test` } });
const run = (cvFile, json) => spawnSync(NODE, [join(ROOT, 'add-entry.mjs'), '--stdin'], {
  cwd: ROOT, input: json, encoding: 'utf8', env: { ...process.env, JOBBER_CV: cvFile, JOBBER_ARTICLE_DIGEST: join(tmpdir(), 'no-such-digest.md') },
});

let dir = null;
let cvFile = null;
try {
  dir = mkdtempSync(join(tmpdir(), 'add-entry-'));
  cvFile = join(dir, 'cv.md');
  writeFileSync(cvFile, CV);
} catch (e) {
  warn(`add-entry fixture could not be built: ${e.message}`);
}

if (cvFile) {
  const r = run(cvFile, payload('Alpha'));
  const after = readFileSync(cvFile, 'utf8');
  if (r.status !== 0) fail(`add-entry exited ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
  else {
    eq('the new entry is in the Projects section', after.includes('- **Alpha** (OSS) -- added by test'), true);
    eq('blank lines BEFORE the edited section are untouched', after.startsWith('# Jane Doe\n\n\n## Summary\n\nShort summary.\n\n\n\n## Projects'), true);
    eq('blank lines AFTER the edited section are untouched', after.endsWith('## Education\n\n\n- BSc, Somewhere\n'), true);
    eq('control: the rebuilt section itself has no blank-line runs', /## Projects\n\n- \*\*Old\*\*[^\n]*\n- \*\*Alpha\*\*/.test(after), true);
    eq('no lock directory is left behind', readdirSync(dir).filter((n) => n.includes('lock')).length, 0);
  }

  // Two concurrent adds under the lock: both entries survive.
  const spawnAdd = (name) => new Promise((resolve) => {
    const c = spawn(NODE, [join(ROOT, 'add-entry.mjs'), '--stdin'], { cwd: ROOT, env: { ...process.env, JOBBER_CV: cvFile, JOBBER_ARTICLE_DIGEST: join(tmpdir(), 'no-such-digest.md') } });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, err }));
    c.stdin.end(payload(name));
  });
  const results = await Promise.all([spawnAdd('Beta'), spawnAdd('Gamma')]);
  const final = readFileSync(cvFile, 'utf8');
  eq('both concurrent adds exit 0', results.map((x) => x.code).join(','), '0,0');
  eq('both concurrent entries are in the CV (no lost update)', final.includes('**Beta**') && final.includes('**Gamma**') && final.includes('**Alpha**'), true);

  const dup = run(cvFile, payload('Alpha'));
  eq('control: adding an existing entry is a no-op duplicate', JSON.parse(dup.stdout).cv.status, 'duplicate');
  rmSync(dir, { recursive: true, force: true });
}
