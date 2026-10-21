// tests/updater-plugin-safety.test.mjs — Workstream D of docs/AUDIT-FIX-PLAN.md.
// Updater: remote SYSTEM_PATHS filter, dirty-system-file guard. Plugins: remove
// path traversal, audit bypasses, lock gate fail-closed. Each fix has a control
// (the case that must keep working) next to the case that used to be wrong.
import { pass, fail, warn, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { sanitizeRemotePaths, dirtySystemPaths } from '../update-system.mjs';
import { auditPlugin } from '../plugin-audit.mjs';
import { ID_RE, lockGate } from '../plugins/_engine.mjs';
import { writeLockEntry, hashPluginTree, consentSurface } from '../plugins/_lock.mjs';

console.log('\nupdater + plugin safety (audit workstream D)');

function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass(label);
  else fail(`${label}: got ${g}, want ${w}`);
}

// ── sanitizeRemotePaths (finding 4) ─────────────────────────────────────
{
  const USER = ['cv.md', 'data/', 'config/profile.yml', 'writing-samples/'];
  const LOCAL = ['modes/', 'writing-samples/README.md'];
  const { kept, dropped } = sanitizeRemotePaths(
    ['modes/', 'docs/new-guide.md', 'cv.md', 'data/', 'data/extra.md', 'config/', '.', './', '../x', '/etc/passwd', ':(top)cv.md', 'C:/Windows', 'a/../../b', 'writing-samples/README.md', 'writing-samples/mine.md'],
    USER,
    LOCAL,
  );
  eq('remote list: legitimate and locally-listed paths are kept', kept, ['modes/', 'docs/new-guide.md', 'writing-samples/README.md']);
  eq('remote list: every dangerous path is dropped, none silently', dropped.map((d) => d.path).sort(), ['./', '.', '../x', '/etc/passwd', ':(top)cv.md', 'C:/Windows', 'a/../../b', 'config/', 'cv.md', 'data/', 'data/extra.md', 'writing-samples/mine.md'].sort());
  eq('remote list: a parent of a user file is dropped with its reason', dropped.find((d) => d.path === 'config/')?.reason, 'overlaps the user layer');
  eq('remote list: a path escape names its reason', dropped.find((d) => d.path === '../x')?.reason, 'path escape');
}

// ── dirtySystemPaths (s1) ───────────────────────────────────────────────
{
  const own = ['AGENTS.md', 'templates/', 'modes/de/'];
  const entries = [
    { code: ' M', path: 'templates/states.yml' },
    { code: 'M ', path: 'AGENTS.md' },
    { code: ' M', path: 'cv.md' },
    { code: '??', path: 'templates/mine.html' },
    { code: ' M', path: 'modes/fr/offre.md' },
  ];
  eq('dirty guard reports tracked edits under system paths only', dirtySystemPaths(entries, own), ['templates/states.yml', 'AGENTS.md']);
  eq('dirty guard: a clean tree reports nothing (control)', dirtySystemPaths([], own), []);
}

// spawned: a real `apply` aborts before touching anything when a system file is dirty
{
  const dir = mkdtempSync(join(tmpdir(), 'upd-dirty-'));
  let setupOk = false;
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    const init = git('init', '-q');
    if (init.status !== 0) throw new Error('git init failed');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    for (const f of ['update-system.mjs', 'package.json']) writeFileSync(join(dir, f), readFileSync(join(ROOT, f)));
    mkdirSync(join(dir, 'lib'), { recursive: true });
    for (const f of ['file-lock.mjs', 'test-discovery.mjs']) {
      if (existsSync(join(ROOT, 'lib', f))) writeFileSync(join(dir, 'lib', f), readFileSync(join(ROOT, 'lib', f)));
    }
    writeFileSync(join(dir, 'VERSION'), '1.0.0\n');
    writeFileSync(join(dir, 'AGENTS.md'), 'original\n');
    git('add', '-A');
    const c = git('commit', '-q', '-m', 'init');
    if (c.status !== 0) throw new Error('git commit failed: ' + c.stderr);
    writeFileSync(join(dir, 'AGENTS.md'), 'my local edit\n');
    setupOk = true;
  } catch (e) {
    warn(`updater fixture could not be built: ${e.message}`);
  }
  if (setupOk) {
    const r = spawnSync(NODE, ['update-system.mjs', 'apply'], { cwd: dir, encoding: 'utf8', timeout: 20000 });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status === 1 && /uncommitted changes in system files/.test(out) && /\bAGENTS\.md\b/.test(out)) pass('apply aborts on a dirty system file and names it');
    else fail(`apply did not abort cleanly (status ${r.status}): ${out.slice(0, 300)}`);
    eq('the dirty file is untouched after the abort', readFileSync(join(dir, 'AGENTS.md'), 'utf8'), 'my local edit\n');
    eq('the update lock is released after the abort', existsSync(join(dir, '.update-lock')), false);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── plugins.mjs remove: id must be a plugin id (finding 3) ──────────────
for (const [id, ok] of [['gmail', true], ['my-plugin2', true], ['../data', false], ['..', false], ['a/b', false], ['', false], ['A', false]]) {
  eq(`plugin id ${JSON.stringify(id)} ${ok ? 'is accepted' : 'is rejected'}`, ID_RE.test(id), ok);
}
{
  const sentinel = join(ROOT, `.remove-sentinel-${process.pid}`);
  let setupOk = false;
  try {
    mkdirSync(sentinel);
    writeFileSync(join(sentinel, 'keep.txt'), 'x');
    setupOk = true;
  } catch (e) {
    warn(`remove sentinel could not be built: ${e.message}`);
  }
  if (setupOk) {
    const r = spawnSync(NODE, ['plugins.mjs', 'remove', `../.remove-sentinel-${process.pid}`], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
    if (r.status !== 0 && /Invalid plugin id/.test(r.stderr || '')) pass('plugins remove ../<dir> is refused with a clear message');
    else fail(`remove did not refuse (status ${r.status}): ${(r.stderr || '').slice(0, 200)}`);
    eq('the directory outside plugins.local/ still exists', existsSync(join(sentinel, 'keep.txt')), true);
  }
  rmSync(sentinel, { recursive: true, force: true });
}

// ── plugin-audit bypasses (N22, N23) ────────────────────────────────────
{
  const cp = 'child' + '_process';
  const fixtures = {
    reexport: { files: { 'index.mjs': `export * from 'node:${cp}';\n` }, want: /forbidden import/ },
    computed: { files: { 'index.mjs': `const m = 'node:' + 'child' + '_process';\nawait import(m);\n` }, want: /computed specifier/ },
    template: { files: { 'index.mjs': 'await import(`node:${"fs"}`);\n' }, want: /computed specifier/ },
    builtin: { files: { 'index.mjs': 'const x = process.get' + `BuiltinModule('node:${cp}');\n` }, want: /getBuiltinModule/ },
    bracket: { files: { 'index.mjs': `const b = process['bin' + 'ding'];\n` }, want: /process\.binding/ },
    escape: { files: { 'index.mjs': `import '../outside.mjs';\n` }, want: /escapes the plugin directory/ },
    modules: { files: { 'index.mjs': 'export default {};\n', 'node_modules/dep/index.mjs': 'export default 1;\n' }, want: /node_modules inside a community plugin/ },
  };
  const clean = { 'index.mjs': `import { join } from 'node:path';\nexport default { notify: async () => join('a', 'b') };\n` };
  const base = mkdtempSync(join(tmpdir(), 'plug-audit-'));
  const build = (name, files) => {
    const dir = join(base, name, 'plugin');
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    return dir;
  };
  let setupOk = false;
  try { for (const [n, f] of Object.entries(fixtures)) build(n, f.files); build('clean', clean); setupOk = true; }
  catch (e) { warn(`audit fixtures could not be built: ${e.message}`); }
  if (setupOk) {
    for (const [name, f] of Object.entries(fixtures)) {
      const res = auditPlugin(join(base, name, 'plugin'));
      const hit = res.findings.some((x) => f.want.test(x.issue));
      if (!res.ok && hit) pass(`audit flags the ${name} bypass for its own reason`);
      else fail(`audit missed the ${name} bypass: ${JSON.stringify(res.findings)}`);
    }
    const ctl = auditPlugin(join(base, 'clean', 'plugin'));
    eq('audit control: a clean plugin has no findings', ctl.findings, []);
  }
  rmSync(base, { recursive: true, force: true });
}

// ── lock gate fails closed (N23, N24) ───────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'plug-lock-'));
  let setupOk = false;
  const dir = join(root, 'plugins.local', 'lp');
  const manifest = { id: 'lp', dir, version: '1.0.0', hooks: ['notify'], requiredEnv: [], optionalEnv: [], allowedHosts: [], allowsLocalhost: false, skill: false };
  const lockFile = join(root, 'plugins.lock');
  const pin = () => {
    const tree = hashPluginTree(dir);
    writeLockEntry(root, 'lp', { source: 'local', version: manifest.version, integrity: tree.integrity, files: tree.files, consent: consentSurface(manifest) });
  };
  const quiet = (fn) => { const o = console.error; const w = console.warn; console.error = () => {}; console.warn = () => {}; try { return fn(); } finally { console.error = o; console.warn = w; } };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.mjs'), 'export default {};\n');
    setupOk = true;
  } catch (e) {
    warn(`lock fixture could not be built: ${e.message}`);
  }
  if (setupOk) {
    eq('control: an unpinned plugin loads and gets pinned', quiet(() => lockGate(manifest, root)).load, true);
    eq('control: the same plugin then matches its pin', quiet(() => lockGate(manifest, root)).load, true);

    writeFileSync(lockFile, '{ this is not json');
    const before = readFileSync(lockFile, 'utf8');
    eq('a corrupt lock refuses to load the plugin', quiet(() => lockGate(manifest, root)).load, false);
    eq('a corrupt lock is not overwritten by an auto re-pin', readFileSync(lockFile, 'utf8'), before);
    rmSync(lockFile);

    pin();
    writeFileSync(join(dir, 'index.mjs'), 'export default { changed: true };\n');
    eq('changed files + a version bump on a local plugin require explicit trust', quiet(() => lockGate({ ...manifest, version: '1.1.0' }, root)).load, false);
    eq('changed files without a bump are refused (existing rug-pull signal)', quiet(() => lockGate(manifest, root)).load, false);

    writeFileSync(join(dir, 'index.mjs'), 'export default {};\n');
    pin();
    eq('control: pinned plugin with unchanged files still loads', quiet(() => lockGate(manifest, root)).load, true);
    eq('a plugin that adds a hook kind is refused until re-consent', quiet(() => lockGate({ ...manifest, hooks: ['notify', 'provider'] }, root)).load, false);
  }
  rmSync(root, { recursive: true, force: true });
}
