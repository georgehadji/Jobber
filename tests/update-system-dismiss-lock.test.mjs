// tests/update-system-dismiss-lock.test.mjs — STATE-MACHINES-PLAN M11 (Phase 2.3).
//   1. `dismiss` must print advice that is true: the old text said to run
//      `check` to re-enable, but `check` returns `dismissed` while the flag exists.
//   2. `.update-lock` needs stale recovery (dead owner PID) via lib/file-lock.mjs,
//      without ever recovering a lock held by a live process.
// Everything runs in a temp fixture (ROOT = the script's own dir). No network:
// `dismissed` returns before any curl, `apply` aborts on a dirty system file
// before any fetch, and the post-delete `check` runs with an empty PATH so curl
// cannot be found (=> `offline`).
import { pass, fail, warn, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

console.log('\nupdate-system: truthful dismiss + stale .update-lock recovery (M11)');

function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass(label);
  else fail(`${label}: got ${g}, want ${w}`);
}

// Fixture: git repo holding update-system.mjs + lib/file-lock.mjs, committed
// clean. Callers dirty AGENTS.md so `apply` aborts right after the lock step.
function buildFixture(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  if (git('init', '-q').status !== 0) throw new Error('git init failed');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  for (const f of ['update-system.mjs', 'package.json']) writeFileSync(join(dir, f), readFileSync(join(ROOT, f)));
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'file-lock.mjs'), readFileSync(join(ROOT, 'lib', 'file-lock.mjs')));
  writeFileSync(join(dir, 'VERSION'), '1.0.0\n');
  writeFileSync(join(dir, 'AGENTS.md'), 'original\n');
  git('add', '-A');
  const c = git('commit', '-q', '-m', 'init');
  if (c.status !== 0) throw new Error('git commit failed: ' + c.stderr);
  return dir;
}

const run = (dir, cmd, env) => {
  const r = spawnSync(NODE, ['update-system.mjs', cmd], { cwd: dir, encoding: 'utf8', timeout: 20000, env: env ?? process.env });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
};

// ── 1. dismiss advice is true ───────────────────────────────────────────
{
  let dir = null;
  try { dir = buildFixture('upd-dismiss-'); } catch (e) { warn(`dismiss fixture could not be built: ${e.message}`); }
  if (dir) {
    const flag = join(dir, '.update-dismissed');
    const d = run(dir, 'dismiss');
    eq('dismiss exits 0 and writes the flag', [d.status, existsSync(flag)], [0, true]);
    if (/\.update-dismissed/.test(d.out) && /delete/i.test(d.out)) pass('dismiss names the real way to re-enable (delete .update-dismissed)');
    else fail(`dismiss message does not name the flag file: ${d.out.trim()}`);
    if (/Run "node update-system\.mjs check"/.test(d.out)) fail(`dismiss still advises running check: ${d.out.trim()}`);
    else pass('dismiss no longer advises running `check` to re-enable');

    // Control: the old advice really was false — check stays dismissed.
    eq('check still returns dismissed while the flag exists', JSON.parse(run(dir, 'check').stdout), { status: 'dismissed' });

    // The advice, followed, works: flag deleted => check proceeds past the
    // dismiss gate. Empty PATH keeps it offline (curl not found).
    rmSync(flag);
    const emptyBin = mkdtempSync(join(tmpdir(), 'upd-nopath-'));
    const after = run(dir, 'check', { ...process.env, PATH: emptyBin, Path: emptyBin });
    let status = null;
    try { status = JSON.parse(after.stdout).status; } catch { /* reported below */ }
    if (status && status !== 'dismissed') pass(`after deleting the flag, check no longer returns dismissed (${status})`);
    else fail(`check after deleting the flag: ${after.out.slice(0, 200)}`);
    rmSync(emptyBin, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 2. .update-lock stale recovery ──────────────────────────────────────
function deadPid() {
  const p = spawnSync(NODE, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(p.stdout);
}
const ownerJson = (pid) => JSON.stringify({ pid, token: 'test-token', started_at: '2020-01-01T00:00:00.000Z', kind: 'update' });

function lockCase(label, pid, expectRecovered) {
  let dir = null;
  try {
    dir = buildFixture('upd-lock-');
    writeFileSync(join(dir, 'AGENTS.md'), 'my local edit\n'); // apply aborts after the lock step
    const lockDir = join(dir, '.update-lock');
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner.json'), ownerJson(pid));
  } catch (e) {
    warn(`${label}: fixture could not be built: ${e.message}`);
    if (dir) rmSync(dir, { recursive: true, force: true });
    return;
  }
  const r = run(dir, 'apply');
  const refused = /already in progress/.test(r.out);
  const reachedAbort = /uncommitted changes in system files/.test(r.out);
  if (expectRecovered) {
    if (reachedAbort && !refused) pass(`${label}: stale lock recovered, apply proceeded past the lock`);
    else fail(`${label}: apply did not recover the lock (status ${r.status}): ${r.out.slice(0, 300)}`);
    eq(`${label}: lock released after apply`, existsSync(join(dir, '.update-lock')), false);
  } else {
    if (refused && r.status === 1 && !reachedAbort) pass(`${label}: live lock refused, apply exits 1`);
    else fail(`${label}: live lock was not respected (status ${r.status}): ${r.out.slice(0, 300)}`);
    let owner = null;
    try { owner = JSON.parse(readFileSync(join(dir, '.update-lock', 'owner.json'), 'utf8')); } catch { /* reported below */ }
    eq(`${label}: the live holder's lock is left untouched`, owner?.token, 'test-token');
  }
  rmSync(dir, { recursive: true, force: true });
}

lockCase('dead-PID lock', deadPid(), true);
lockCase('live-PID lock (this process, fresh)', process.pid, false);

// Legacy: a plain-file .update-lock (written by the old updater, ISO timestamp)
// is ownerless; once older than the stale window it is recovered, not fatal.
{
  let dir = null;
  try {
    dir = buildFixture('upd-lock-legacy-');
    writeFileSync(join(dir, 'AGENTS.md'), 'my local edit\n');
    writeFileSync(join(dir, '.update-lock'), '2020-01-01T00:00:00.000Z');
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(join(dir, '.update-lock'), old, old);
  } catch (e) {
    warn(`legacy lock fixture could not be built: ${e.message}`);
  }
  if (dir) {
    const r = run(dir, 'apply');
    if (/uncommitted changes in system files/.test(r.out)) pass('legacy plain-file .update-lock (old timestamp) is recovered');
    else fail(`legacy lock blocked apply (status ${r.status}): ${r.out.slice(0, 300)}`);
    rmSync(dir, { recursive: true, force: true });
  }
}
