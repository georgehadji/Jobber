// tests/file-lock-recover-race.test.mjs — lib/file-lock.mjs stale recovery must never delete a lock that
// is no longer stale. Found as a rare flake in tests/pipeline-inbox.test.mjs under load: a contender that
// judged a lock stale (or saw it vanish, which lockCanRecover also calls "stale") removed the FRESH lock
// another caller had created in the gap, so two holders ran at once (lost update, or ENOENT writing
// owner.json). Recovery now re-judges right before removing and treats a vanished lock as "retry".
// The `beforeRecoverRemove` seam swaps the lock inside that window, deterministically.
import { pass, fail, warn } from './helpers.mjs';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { acquireLock, acquireLockSync, LockTimeoutError } from '../lib/file-lock.mjs';

console.log('\nfile-lock: stale recovery never deletes a fresh lock');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const work = mkdtempSync(join(tmpdir(), 'file-lock-race-'));
let n = 0;
const target = () => join(work, `f${n++}.md`);

// a pid that is certainly dead: a child that already exited
let deadPid = null;
try { const r = spawnSync(process.execPath, ['-e', '']); deadPid = r.pid; } catch { /* handled below */ }
if (!Number.isInteger(deadPid)) { warn('could not obtain a dead pid; recovery-race tests skipped'); }
else {
  const staleLock = (file) => { // a lock whose owner is dead => genuinely stale
    const dir = `${file}.lock`;
    mkdirSync(dir);
    writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: deadPid, token: 'dead' }));
    return dir;
  };
  // the swap: move the stale lock aside (so an inode cannot be reused) and put a LIVE lock in its place
  const swapForFresh = (dir) => {
    renameSync(dir, `${dir}.old`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'fresh' }));
  };
  const ownerToken = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')).token; } catch { return null; } };

  try {
    // ── async ──────────────────────────────────────────────────────────────
    const f = target(); const dir = staleLock(f);
    let err = null;
    try { await acquireLock(f, { timeoutMs: 400, retryMs: 20, staleMs: 30_000, beforeRecoverRemove: () => swapForFresh(dir) }); } catch (e) { err = e; }
    eq('async: a lock swapped for a fresh live one in the recovery window is NOT removed (caller times out instead)', [err instanceof LockTimeoutError, existsSync(dir), ownerToken(dir)], [true, true, 'fresh']);

    // control: with no swap the stale lock IS recovered (recovery itself still works)
    const g = target(); staleLock(g);
    const lock = await acquireLock(g, { timeoutMs: 2000, retryMs: 20, staleMs: 30_000 });
    eq('control (async): a genuinely stale lock is still recovered', [lock.staleRecovered, ownerToken(lock.lockDir) !== 'dead' && ownerToken(lock.lockDir) !== null], [true, true]);
    lock.release();
    eq('control (async): the recovered lock releases cleanly', existsSync(`${g}.lock`), false);

    // ── sync twin ──────────────────────────────────────────────────────────
    const h = target(); const hdir = staleLock(h);
    let serr = null;
    try { acquireLockSync(h, { timeoutMs: 400, retryMs: 20, staleMs: 30_000, beforeRecoverRemove: () => swapForFresh(hdir) }); } catch (e) { serr = e; }
    eq('sync: a lock swapped for a fresh live one in the recovery window is NOT removed', [serr instanceof LockTimeoutError, existsSync(hdir), ownerToken(hdir)], [true, true, 'fresh']);
    const k = target(); staleLock(k);
    const sl = acquireLockSync(k, { timeoutMs: 2000, retryMs: 20, staleMs: 30_000 });
    eq('control (sync): a genuinely stale lock is still recovered', existsSync(join(sl.lockDir, 'owner.json')), true);
    sl.release();

    // ── recover guard: same discipline (a stale guard swapped for a live one must survive) ──
    const liveLock = (file) => { const d = `${file}.lock`; mkdirSync(d); writeFileSync(join(d, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'live' })); return d; };
    const staleGuard = (file) => { const g = `${file}.lock.recover`; mkdirSync(g); const old = new Date(Date.now() - 10_000); utimesSync(g, old, old); return g; };
    const swapGuard = (g) => { renameSync(g, `${g}.old`); mkdirSync(g); writeFileSync(join(g, 'marker'), 'fresh'); };
    const opts = { timeoutMs: 400, retryMs: 20, staleMs: 1000 };
    const m1 = target(); const l1 = liveLock(m1); const g1 = staleGuard(m1);
    let gerr = null;
    try { await acquireLock(m1, { ...opts, beforeGuardRemove: () => swapGuard(g1) }); } catch (e) { gerr = e; }
    eq('async: a stale guard swapped for a live one in the removal window is NOT removed', [gerr instanceof LockTimeoutError, existsSync(join(g1, 'marker')), ownerToken(l1)], [true, true, 'live']);
    const m2 = target(); liveLock(m2); const g2 = staleGuard(m2);
    try { await acquireLock(m2, opts); } catch { /* the lock is live, so this times out */ }
    eq('control (async): a genuinely stale guard IS removed (it cannot wedge recovery)', existsSync(g2), false);
    const m3 = target(); const l3 = liveLock(m3); const g3 = staleGuard(m3);
    let gserr = null;
    try { acquireLockSync(m3, { ...opts, beforeGuardRemove: () => swapGuard(g3) }); } catch (e) { gserr = e; }
    eq('sync: a stale guard swapped for a live one in the removal window is NOT removed', [gserr instanceof LockTimeoutError, existsSync(join(g3, 'marker')), ownerToken(l3)], [true, true, 'live']);
    const m4 = target(); liveLock(m4); const g4 = staleGuard(m4);
    try { acquireLockSync(m4, opts); } catch { /* times out */ }
    eq('control (sync): a genuinely stale guard IS removed', existsSync(g4), false);
  } catch (e) {
    fail(`recovery-race tests threw: ${e.message}`);
  }
}
rmSync(work, { recursive: true, force: true });
