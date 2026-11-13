// tests/plugin-repin-warning.test.mjs — STATE-MACHINES-PLAN D9: a BUNDLED plugin whose files changed
// without a version bump is still re-pinned and loaded, but no longer silently.
//   drift-nobump + bundled -> load:true, ONE warning naming the plugin and the changed file, lock re-pinned
//   control: the very next load (now a match) is silent
//   control: unchanged bundled plugin is silent
//   control: bundled change WITH a version bump (legit-update) stays silent
//   control: a LOCAL plugin with the same drift is still refused (load:false), not re-pinned
import { pass, fail, warn } from './helpers.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeLockEntry, hashPluginTree, consentSurface, readLockStrict } from '../plugins/_lock.mjs';
import { lockGate } from '../plugins/_engine.mjs';

console.log('\nbundled plugin re-pin warning (D9)');

const root = mkdtempSync(join(tmpdir(), 'plug-repin-'));
const quiet = (fn) => {
  const w = console.warn, lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  try { return { value: fn(), lines }; } finally { console.warn = w; }
};
const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

// Build + pin one plugin dir at `dir`; `source` is the lock's recorded source.
function fixture(base, source) {
  let man;
  try {
    const dir = join(base, 'bp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), '{}');
    writeFileSync(join(dir, 'index.mjs'), 'export default {};');
    man = { id: 'bp', dir, version: '1.0.0', hooks: ['ingest'], requiredEnv: [], allowedHosts: [], allowsLocalhost: false, skill: null };
    const tree = hashPluginTree(dir);
    writeLockEntry(base, 'bp', { source, version: '1.0.0', integrity: tree.integrity, files: tree.files, consent: consentSurface(man) });
  } catch (e) { warn(`fixture could not be built: ${e.message}`); return null; }
  return man;
}

try {
  // bundled = a dir under <root>/plugins/
  const bundledRoot = join(root, 'b'); mkdirSync(join(bundledRoot, 'plugins'), { recursive: true });
  const man = fixture(join(bundledRoot, 'plugins'), 'bundled');
  if (man) {
    // writeLockEntry above wrote plugins.lock under <root>/plugins; the gate reads <root>/plugins.lock
    const tree = hashPluginTree(man.dir);
    writeLockEntry(bundledRoot, 'bp', { source: 'bundled', version: '1.0.0', integrity: tree.integrity, files: tree.files, consent: consentSurface(man) });

    const same = quiet(() => lockGate(man, bundledRoot));
    eq('control: unchanged bundled plugin loads silently', [same.value.load, same.lines], [true, []]);

    writeFileSync(join(man.dir, 'index.mjs'), 'export default { changed: true };'); // edit, no version bump
    const r1 = quiet(() => lockGate(man, bundledRoot));
    const msg = r1.lines.join('\n');
    eq('drift-nobump on a bundled plugin still loads', r1.value.load, true);
    eq('...with exactly one warning', r1.lines.length, 1);
    eq('...naming the plugin, the missing bump and the changed file', [/bp: bundled plugin files changed without a version bump/.test(msg), msg.includes('index.mjs')], [true, true]);
    const pinned = readLockStrict(bundledRoot).plugins.bp.integrity;
    eq('...and re-pins the lock to the new tree', pinned, hashPluginTree(man.dir).integrity);
    const r2 = quiet(() => lockGate(man, bundledRoot));
    eq('control: the next load (now a match) is silent', [r2.value.load, r2.lines], [true, []]);

    writeFileSync(join(man.dir, 'index.mjs'), 'export default { changed: 2 };');
    const bumped = quiet(() => lockGate({ ...man, version: '1.0.1' }, bundledRoot));
    eq('control: a bundled change WITH a version bump stays silent', [bumped.value.load, bumped.lines], [true, []]);
  }

  // local = a dir outside <root>/plugins/
  const localRoot = join(root, 'l'); mkdirSync(localRoot, { recursive: true });
  const lman = fixture(join(localRoot, 'plugins.local'), 'local');
  if (lman) {
    const tree = hashPluginTree(lman.dir);
    writeLockEntry(localRoot, 'bp', { source: 'local', version: '1.0.0', integrity: tree.integrity, files: tree.files, consent: consentSurface(lman) });
    writeFileSync(join(lman.dir, 'index.mjs'), 'export default { evil: true };');
    const lr = quiet(() => lockGate(lman, localRoot));
    eq('control: a LOCAL plugin with the same drift is still refused', lr.value.load, false);
    eq('...and its lock entry is not re-pinned', readLockStrict(localRoot).plugins.bp.integrity, tree.integrity);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
