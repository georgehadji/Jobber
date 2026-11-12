/**
 * updater-dismiss-and-lock.test.mjs — dismiss/force-check and .update-lock stale recovery.
 * Spawns a COPY of update-system.mjs inside a throwaway git repo so ROOT is isolated.
 */
import { mkdtempSync, writeFileSync, existsSync, readFileSync, copyFileSync, utimesSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync, spawn } from 'child_process';
import { pass, fail, warn } from './helpers.mjs';
import { ROOT as REPO } from './helpers.mjs';
import { acquireUpdateLock, updateLockIsStale } from '../update-system.mjs';

console.log('\n🧪 Testing updater dismiss + lock recovery...');

function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'co-updlock-'));
  copyFileSync(join(REPO, 'update-system.mjs'), join(dir, 'update-system.mjs'));
  const g = spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  if (g.status !== 0) throw new Error('git init failed: ' + g.stderr);
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, ['update-system.mjs', ...args], {
  cwd: dir, encoding: 'utf-8', timeout: 60000,
  env: { ...process.env, JOBBER_GIT_TIMEOUT_MS: '5000', JOBBER_GIT_FETCH_TIMEOUT_MS: '5000' },
});

let dir = null;
try { dir = makeSandbox(); } catch (e) { warn(`updater sandbox could not be built, skipping: ${e.message}`); }

if (dir) {
  const dismissed = join(dir, '.update-dismissed');
  const lock = join(dir, '.update-lock');

  // ── Bug 1: dismiss advice ──
  const d = run(dir, 'dismiss');
  const advised = /check --force/.test(d.stdout);
  advised ? pass('dismiss message points at "check --force"') : fail(`dismiss message wrong: ${d.stdout}`);
  existsSync(dismissed) ? pass('dismiss writes .update-dismissed') : fail('dismiss did not write flag');

  const plain = run(dir, 'check');
  plain.stdout.includes('"status":"dismissed"') && existsSync(dismissed)
    ? pass('control: plain check stays "dismissed" and keeps the flag')
    : fail(`plain check after dismiss: ${plain.stdout} ${plain.stderr}`);

  const forced = run(dir, 'check', '--force');
  const fOut = forced.stdout + forced.stderr;
  (!existsSync(dismissed) && !fOut.includes('"status":"dismissed"'))
    ? pass('check --force clears dismissal and does not report "dismissed"')
    : fail(`check --force did not re-enable: ${fOut}`);

  // ── Bug 2: lock, user-visible via spawned apply ──
  // apply() reaches lock acquisition after local git status; a held lock must refuse there.
  writeFileSync(lock, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
  const held = run(dir, 'apply');
  (held.status === 1 && /Update already in progress/.test(held.stderr) && existsSync(lock))
    ? pass('apply refuses when lock owner PID is alive (message printed, lock kept)')
    : fail(`live-PID lock not refused: status=${held.status} ${held.stderr}`);

  // dead PID: spawn and reap a short-lived child to get a PID that is gone
  const dead = spawnSync(process.execPath, ['-e', '']);
  const deadPid = dead.pid;
  writeFileSync(lock, JSON.stringify({ pid: deadPid, created_at: new Date().toISOString() }));
  const rec = run(dir, 'apply');
  (/Recovered stale \.update-lock/.test(rec.stderr) && !/Update already in progress/.test(rec.stderr))
    ? pass('apply recovers a lock whose PID is dead (notice printed)')
    : fail(`dead-PID lock not recovered: ${rec.stderr}`);
  !existsSync(lock) ? pass('lock released after recovered apply ended') : fail('lock leaked after recovered apply');

  rmSync(dir, { recursive: true, force: true });
}

// ── Direct function checks (identity of reason) ──
let d2 = null;
try { d2 = mkdtempSync(join(tmpdir(), 'co-updlock2-')); } catch (e) { warn(`tmp dir failed: ${e.message}`); }
if (d2) {
  const lock = join(d2, '.update-lock');
  const hours = (h) => new Date(Date.now() - h * 3600e3);

  // fresh acquire writes JSON {pid, created_at}
  acquireUpdateLock(lock);
  const meta = JSON.parse(readFileSync(lock, 'utf-8'));
  (meta.pid === process.pid && !Number.isNaN(Date.parse(meta.created_at)))
    ? pass('acquire writes {pid, created_at} JSON') : fail(`bad lock body: ${JSON.stringify(meta)}`);
  acquireUpdateLock(lock) === false ? pass('second acquire by live owner is refused') : fail('live lock was stolen');
  rmSync(lock);

  // legacy timestamp, old -> stale/recovered
  writeFileSync(lock, hours(3).toISOString());
  const oldStale = updateLockIsStale(lock);
  const oldRec = acquireUpdateLock(lock);
  (oldStale === true && oldRec === true && JSON.parse(readFileSync(lock, 'utf-8')).pid === process.pid)
    ? pass('legacy timestamp lock older than 2h is recovered') : fail(`old legacy: stale=${oldStale} acquired=${oldRec}`);
  rmSync(lock);

  // legacy timestamp, fresh -> refuses (control)
  writeFileSync(lock, hours(0.1).toISOString());
  const freshStale = updateLockIsStale(lock);
  const freshAcq = acquireUpdateLock(lock);
  (freshStale === false && freshAcq === false && !/pid/.test(readFileSync(lock, 'utf-8')))
    ? pass('legacy timestamp lock younger than 2h is refused and left intact')
    : fail(`fresh legacy: stale=${freshStale} acquired=${freshAcq}`);

  // unparsable content falls back to mtime
  writeFileSync(lock, 'garbage');
  utimesSync(lock, hours(3), hours(3));
  const garbOld = updateLockIsStale(lock);
  const now = new Date(); utimesSync(lock, now, now);
  const garbNew = updateLockIsStale(lock);
  (garbOld === true && garbNew === false)
    ? pass('unparsable lock judged by mtime (old stale, fresh not)') : fail(`garbage: old=${garbOld} new=${garbNew}`);

  rmSync(d2, { recursive: true, force: true });
}
