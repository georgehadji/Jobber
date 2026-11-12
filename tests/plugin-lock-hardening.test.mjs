// tests/plugin-lock-hardening.test.mjs — Phase 3.7 (docs/STATE-MACHINES-PLAN.md, M8).
// plugins.lock writes: strict read (a corrupt lock is refused, never replaced by a
// one-entry file), serialized under lib/file-lock.mjs, atomic; repin failures are
// reported; lockGate fails closed on an unknown diff status. Every refusal test has
// a control next to it (a valid lock that must still work).
import { pass, fail, warn } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { writeLockEntry, removeLockEntry, readLockStrict } from '../plugins/_lock.mjs';
import { lockGate } from '../plugins/_engine.mjs';

console.log('\nplugin lock hardening (phase 3.7)');

function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass(label); else fail(`${label}: got ${g}, want ${w}`);
}
const quiet = (fn) => {
  const e = console.error, w = console.warn, lines = [];
  console.error = (...a) => lines.push(a.join(' ')); console.warn = (...a) => lines.push(a.join(' '));
  try { return { value: fn(), lines }; } finally { console.error = e; console.warn = w; }
};
const entry = (n) => ({ source: 'local', version: '1.0.0', integrity: 'sha256-' + n, files: {}, consent: {} });
const root = mkdtempSync(join(tmpdir(), 'plug-lock-hard-'));
const sub = (name) => { const d = join(root, name); mkdirSync(d, { recursive: true }); return d; };
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
const ids = (r) => Object.keys(readLockStrict(r).plugins).sort();

try {
  // ── corrupt lock: refuse, byte-unchanged (writer + remover) ───────────────
  {
    const r = sub('corrupt');
    const lock = join(r, 'plugins.lock');
    let setup = false;
    try {
      writeFileSync(lock, JSON.stringify({ lockfileVersion: 1, plugins: { a: entry('a'), b: entry('b') } }, null, 2) + '\n');
      setup = true;
    } catch (e) { warn(`corrupt-lock fixture could not be built: ${e.message}`); }
    if (setup) {
      const good = readFileSync(lock, 'utf8');
      writeLockEntry(r, 'c', entry('c'));
      eq('control: valid lock, trust-style write keeps the other pins', ids(r), ['a', 'b', 'c']);
      removeLockEntry(r, 'c');
      eq('control: valid lock, remove drops only that entry', ids(r), ['a', 'b']);
      eq('control: valid lock round-trips byte-identically after add+remove', readFileSync(lock, 'utf8'), good);

      for (const [label, bytes] of [['truncated json', '{ "lockfileVersion": 1, "plugins": { "a": '], ['null plugins', '{"plugins": null}'], ['not an object', '[]']]) {
        writeFileSync(lock, bytes);
        const w = throws(() => writeLockEntry(r, 'x', entry('x')));
        eq(`corrupt lock (${label}): writeLockEntry refuses with a recovery hint`, /refusing to update plugins\.lock/.test(w || '') && /fix or delete/.test(w || ''), true);
        eq(`corrupt lock (${label}): file is byte-unchanged after writeLockEntry`, readFileSync(lock, 'utf8'), bytes);
        const rm = throws(() => removeLockEntry(r, 'a'));
        eq(`corrupt lock (${label}): removeLockEntry refuses`, /refusing to update plugins\.lock/.test(rm || ''), true);
        eq(`corrupt lock (${label}): file is byte-unchanged after removeLockEntry`, readFileSync(lock, 'utf8'), bytes);
      }
      eq('no lock dir or tmp left behind after refusals', readdirSync(r).sort(), ['plugins.lock']);
    }
  }

  // ── absent lock: created fresh (control: "refuse" must not mean "always throw") ──
  {
    const r = sub('absent');
    eq('control: absent lock is created by the first write', throws(() => writeLockEntry(r, 'a', entry('a'))), null);
    eq('control: ...and contains it', ids(r), ['a']);
    const r2 = sub('absent2');
    removeLockEntry(r2, 'zz');
    eq('remove on an absent lock is a no-op that creates nothing', readdirSync(r2), []);
  }

  // ── atomic: no tmp / lock dir left after writes ──────────────────────────
  {
    const r = sub('atomic');
    for (let i = 0; i < 5; i++) writeLockEntry(r, 'p' + i, entry(i));
    eq('atomic write leaves only plugins.lock (no *.tmp, no .lock dir)', readdirSync(r).sort(), ['plugins.lock']);
  }

  // ── concurrent writers lose no entry ─────────────────────────────────────
  {
    const r = sub('concurrent');
    const modUrl = pathToFileURL(join(import.meta.dirname, '..', 'plugins', '_lock.mjs')).href;
    const N = 4, EACH = 15;
    const worker = (w) => new Promise((resolve) => {
      const code = `import(${JSON.stringify(modUrl)}).then(m=>{for(let i=0;i<${EACH};i++)m.writeLockEntry(${JSON.stringify(r)},'w${w}-'+i,{source:'local',version:'1.0.0',integrity:'x',files:{},consent:{}});})`;
      const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; c.stderr.on('data', (d) => { err += d; });
      c.on('close', (status) => resolve({ status, err }));
    });
    const results = await Promise.all(Array.from({ length: N }, (_, w) => worker(w)));
    const bad = results.filter((x) => x.status !== 0);
    if (bad.length) fail(`concurrent writers: ${bad.length} worker(s) failed: ${bad[0].err.slice(0, 300)}`);
    else {
      const have = new Set(ids(r));
      const missing = [];
      for (let w = 0; w < N; w++) for (let i = 0; i < EACH; i++) if (!have.has(`w${w}-${i}`)) missing.push(`w${w}-${i}`);
      eq(`${N} concurrent processes x ${EACH} writes: no entry lost`, missing, []);
      eq('concurrent writers leave no tmp / lock dir', readdirSync(r).sort(), ['plugins.lock']);
    }
  }

  // ── repin failure is reported, load behaviour unchanged ──────────────────
  {
    const r = sub('repin');
    const dir = join(r, 'plugins', 'bp');
    let setup = false;
    try { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'index.mjs'), 'export default {};\n'); setup = true; }
    catch (e) { warn(`repin fixture could not be built: ${e.message}`); }
    if (setup) {
      const manifest = { id: 'bp', dir, version: '1.0.0', hooks: ['notify'], requiredEnv: [], optionalEnv: [], allowedHosts: [], allowsLocalhost: false, skill: false };
      // Simulated by injecting a throwing writer at the writeLockEntry boundary (the test seam lockGate exposes);
      // the real-fs failure (EACCES/ENOSPC on rename) is not reproducible portably, esp. on Windows.
      const boom = () => { throw new Error('EACCES: simulated lock write failure'); };
      const bad = quiet(() => lockGate(manifest, r, { write: boom }));
      eq('repin write failure: plugin still loads (unpinned grandfathering unchanged)', bad.value.load, true);
      eq('repin write failure: a warning names the plugin and the cause', bad.lines.some((l) => l.includes('bp') && l.includes('could not re-pin') && l.includes('simulated lock write failure')), true);
      const ok = quiet(() => lockGate(manifest, r));
      eq('control: working write loads and emits no re-pin warning', [ok.value.load, ok.lines.some((l) => l.includes('could not re-pin'))], [true, false]);
      eq('control: ...and actually pinned it', ids(r), ['bp']);
    }
  }

  // ── unknown diff status fails closed ─────────────────────────────────────
  {
    const r = sub('unknown');
    const dir = join(r, 'plugins.local', 'up');
    let setup = false;
    try { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'index.mjs'), 'export default {};\n'); setup = true; }
    catch (e) { warn(`unknown-status fixture could not be built: ${e.message}`); }
    if (setup) {
      const manifest = { id: 'up', dir, version: '1.0.0', hooks: ['notify'], requiredEnv: [], optionalEnv: [], allowedHosts: [], allowsLocalhost: false, skill: false };
      const diffOf = (status) => () => ({ status, changedFiles: [], addedHosts: [], addedEnv: [], addedHooks: [] });
      const bogus = quiet(() => lockGate(manifest, r, { diff: diffOf('bogus-new-status') }));
      eq('unknown diff status: lockGate refuses to load', bogus.value.load, false);
      eq('unknown diff status: reason names the plugin and the status', bogus.lines.some((l) => l.includes('up') && l.includes('bogus-new-status')), true);
      eq('control: a known status (match) loads through the same seam', quiet(() => lockGate(manifest, r, { diff: diffOf('match') })).value.load, true);
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
