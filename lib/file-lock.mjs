// lib/file-lock.mjs — one cross-process advisory lock, shared by every writer.
//
// This is the extraction named in #improvement-plan A2: `lockCanRecover` /
// acquisition / release used to be copy-pasted near-verbatim into
// tracker-utils.mjs, pipeline-lock.mjs, portal-health-lock.mjs and
// followup-seed.mjs — the trickiest concurrency code in the repo, in four
// copies with four stale defaults. Concurrency is exactly where duplication is
// a correctness liability, not untidiness: a fix to the ownerless-grace or the
// recover-guard subtlety in one copy silently never reached the other three.
//
// One implementation, parameterised by the two things the callers actually
// differ on:
//   - timing defaults (tracker uses a 10-minute stale window; pipeline and
//     portal-health use 30s), and
//   - the owner.json record fields (tracker records `tracker`, pipeline
//     records `pipeline`, portal-health records `file`).
//
// The contract is the same one every caller already relied on:
//   - the lock is a directory ("<path>.lock"); a mkdir is atomic.
//   - the holder records owner.json — pid, a unique token, started_at, plus
//     caller-owned extra fields — so both stale-reclaim and release can verify
//     who actually owns the lock before deleting anything.
//   - staleness is judged by owner-PID liveness first, falling back to
//     directory age only when the metadata is missing or unreadable. An old
//     lock whose owner is still running is NOT stale, and an ownerless
//     directory gets a fixed grace period (OWNERLESS_GRACE_MS) before age
//     alone can condemn it.
//   - stale reclamation is serialized behind a second atomic guard directory
//     ("<path>.lock.recover"), so two callers judging the same lock stale can
//     never have the second's rmSync delete the first's freshly created lock.
//
// Pure-ish module: imports fs/path/crypto and does no I/O or process control
// at import time. Entrypoints (root *.mjs) call acquireLock/withLock at the
// shell edge. See CONTRIBUTING.md for the lib/-vs-root rule (#improvement-plan
// A7).

import { mkdirSync, rmSync, statSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

/** Minimum age before directory age alone may condemn an ownerless lock or
 * recover guard. See `lockCanRecover` for why the age check needs a floor. */
export const OWNERLESS_GRACE_MS = 1_000;

export class LockTimeoutError extends Error {
  constructor(lockDir, timeoutMs, kind = 'file') {
    super(`${kind} lock timeout: ${lockDir} held > ${timeoutMs}ms`);
    this.name = 'LockTimeoutError';
    this.lockDir = lockDir;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lockDirFor(filePath) {
  return `${filePath}.lock`;
}

/** Owner metadata for a lock directory, or null when missing/unreadable. */
export function readLockOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf-8'));
  } catch {
    return null;
  }
}

// Identity of a directory, so a lock removed and recreated by another process
// is never mistaken for the one this caller created.
function sameLockDirectory(left, right) {
  return left.dev === right.dev && left.ino === right.ino
    && (left.ino !== 0 || left.birthtimeMs === right.birthtimeMs);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM'; // exists, just not signalable by this user
  }
}

// Conservative: a lock whose recorded owner is still running is never stale,
// however old it is. Age is the fallback only when there's no readable owner.
//
// That fallback needs a floor. Two directories are ownerless by construction,
// not by accident: a lock between its mkdir and its owner.json write, and the
// recover guard, which never carries owner.json at all. Judging those on
// `age > staleMs` alone lets a caller with an aggressive staleMs delete a
// directory created microseconds ago — either stealing a winner's lock inside
// its acquisition window, or evicting a live guard and putting two callers
// inside the decide-then-delete window the guard exists to serialize.
// OWNERLESS_GRACE_MS is a lower bound on that patience, never a cap: a larger
// caller staleMs still wins, and a genuinely abandoned directory still ages
// out, so a crash while holding the guard cannot disable recovery for good.
export function lockCanRecover(lockDir, staleMs) {
  const owner = readLockOwner(lockDir);
  if (owner?.pid) return !processIsAlive(owner.pid);
  try {
    return Date.now() - statSync(lockDir).mtimeMs > Math.max(staleMs, OWNERLESS_GRACE_MS);
  } catch {
    return true; // vanished — nothing to recover, retry acquisition
  }
}

/**
 * Blocks until the lock on `filePath` is held, then returns a handle whose
 * release() frees it. Throws LockTimeoutError if the lock stays busy.
 *
 * @param {string} filePath - File the lock guards (owner.json records it under `owner`).
 * @param {object} [options]
 * @param {number} [options.timeoutMs=60000] - Max time to wait for the lock.
 * @param {number} [options.retryMs=75] - Delay between acquisition attempts.
 * @param {number} [options.staleMs=10*60_000] - Age threshold for a lock with no readable owner, floored at OWNERLESS_GRACE_MS.
 * @param {string} [options.kind='file'] - Label used in the timeout message (e.g. 'tracker').
 * @param {object} [options.owner] - Extra fields recorded in owner.json (e.g. { tracker, pipeline, file }).
 * @param {boolean} [options.ensureParentDir=false] - mkdir -p the lock's parent before acquiring (fresh installs).
 * @param {Function} [options.removeLock] - Release hook for deterministic fault tests.
 * @returns {Promise<{lockDir:string,attempts:number,waitMs:number,staleRecovered:boolean,release:Function}>}
 */
export async function acquireLock(filePath, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const retryMs = options.retryMs ?? 75;
  const staleMs = options.staleMs ?? 10 * 60_000;
  const kind = options.kind ?? 'file';
  const ownerExtra = options.owner ?? {};
  const lockDir = options.lockDir ?? lockDirFor(filePath);
  const recoverGuardDir = `${lockDir}.recover`;
  const token = randomUUID();
  const startedAt = Date.now();
  let attempts = 0;
  let staleRecovered = false;

  if (options.ensureParentDir) {
    // A fresh install may not have data/ yet — create it so mkdirSync(lockDir)
    // cannot throw a raw ENOENT.
    mkdirSync(dirname(lockDir), { recursive: true });
  }

  while (Date.now() - startedAt < timeoutMs) {
    attempts++;
    try {
      mkdirSync(lockDir);
      try {
        writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
          pid: process.pid,
          token,
          started_at: new Date().toISOString(),
          ...ownerExtra,
        }, null, 2));
      } catch (ownerErr) {
        // We created the dir but could not record ownership. An empty,
        // owner-less lock dir would block every future locker until the
        // staleMs age-out — remove what we just created before rethrowing.
        rmSync(lockDir, { recursive: true, force: true });
        throw ownerErr;
      }

      let ownerVerified = false;
      let verifiedDir = null;
      let released = false;
      const removeLock = typeof options.removeLock === 'function'
        ? options.removeLock
        : (p) => rmSync(p, { recursive: true, force: true });
      return {
        lockDir,
        attempts,
        waitMs: Date.now() - startedAt,
        staleRecovered,
        release() {
          if (released) return;
          if (ownerVerified) {
            let currentDir;
            try {
              currentDir = statSync(lockDir);
            } catch (err) {
              if (err?.code === 'ENOENT') { released = true; return; }
              throw err;
            }
            if (!sameLockDirectory(verifiedDir, currentDir)) {
              released = true;
              return;
            }
            const owner = readLockOwner(lockDir);
            if (owner && owner.token !== token) { released = true; return; }
            if (!owner && existsSync(join(lockDir, 'owner.json'))) {
              throw new Error(`Cannot verify lock ownership at ${lockDir}`);
            }
          } else {
            let beforeRead;
            try {
              beforeRead = statSync(lockDir);
            } catch (err) {
              if (err?.code === 'ENOENT') { released = true; return; }
              throw err;
            }
            const owner = readLockOwner(lockDir);
            if (owner?.token !== token) {
              if (owner) released = true;
              else throw new Error(`Cannot verify lock ownership at ${lockDir}`);
              return;
            }
            const afterRead = statSync(lockDir);
            if (!sameLockDirectory(beforeRead, afterRead)) {
              released = true;
              return;
            }
            ownerVerified = true;
            verifiedDir = afterRead;
          }
          removeLock(lockDir);
          released = true;
        },
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;

      let hasRecoverGuard = false;
      try {
        mkdirSync(recoverGuardDir);
        hasRecoverGuard = true;
      } catch (guardErr) {
        if (guardErr?.code !== 'EEXIST') throw guardErr;
        if (lockCanRecover(recoverGuardDir, staleMs)) {
          rmSync(recoverGuardDir, { recursive: true, force: true });
        }
      }

      if (hasRecoverGuard) {
        try {
          if (lockCanRecover(lockDir, staleMs)) {
            rmSync(lockDir, { recursive: true, force: true });
            staleRecovered = true;
            continue;
          }
        } finally {
          rmSync(recoverGuardDir, { recursive: true, force: true });
        }
      }

      await sleep(retryMs);
    }
  }

  const timeoutErr = new LockTimeoutError(lockDir, timeoutMs, kind);
  throw timeoutErr;
}

/**
 * Acquires the lock on `filePath`, runs fn, and always releases it.
 *
 * @param {string} filePath - File the lock guards.
 * @param {object} options - Same options as acquireLock.
 * @param {Function} fn - Async work to run while holding the lock.
 */
export async function withLock(filePath, options, fn) {
  if (typeof options === 'function') { fn = options; options = {}; }
  const lock = await acquireLock(filePath, options);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
