// portal-health-lock.mjs — cross-process advisory lock for
// data/portal-health.tsv, so appendPortalHealth() (scan.mjs) and any
// read-modify-write cleanup of the same file (tests/portal-health-guard.mjs)
// can never interleave.
//
// This is now a thin facade over the single shared lock implementation in
// lib/file-lock.mjs (#improvement-plan A2): a 30s stale window (portal-health
// appends are short), owner.json records the file path, and the parent data/
// directory is created for a fresh install. All concurrency correctness lives
// in lib/file-lock.mjs.

import { acquireLock, withLock, LockTimeoutError, OWNERLESS_GRACE_MS } from './lib/file-lock.mjs';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 80;
const DEFAULT_TIMEOUT_MS = 8_000;

export { OWNERLESS_GRACE_MS };
export { LockTimeoutError };

function lockDirFor(filePath) {
  return `${filePath}.lock`;
}

/**
 * Blocks until the lock on `filePath` is held, then returns a handle whose
 * release() frees it. Throws LockTimeoutError if the lock stays busy.
 *
 * @param {string} filePath - File the lock guards.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=8000] - Max time to wait for the lock.
 * @param {number} [options.retryMs=80] - Delay between acquisition attempts.
 * @param {number} [options.staleMs=30000] - Age threshold for a lock with no readable owner.
 */
export async function acquirePortalHealthLock(filePath, options = {}) {
  return acquireLock(filePath, {
    timeoutMs: options.timeoutMs ?? (Number(process.env.JOBBER_PORTAL_HEALTH_LOCK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    retryMs: options.retryMs ?? (Number(process.env.JOBBER_PORTAL_HEALTH_LOCK_RETRY_MS) || DEFAULT_RETRY_MS),
    staleMs: options.staleMs ?? (Number(process.env.JOBBER_PORTAL_HEALTH_LOCK_STALE_MS) || DEFAULT_STALE_MS),
    kind: 'portal-health',
    owner: { file: filePath },
    ensureParentDir: true,
  });
}

/** Acquires the lock on `filePath`, runs fn, and always releases it. */
export async function withPortalHealthLock(filePath, fn, options = {}) {
  return withLock(filePath, {
    timeoutMs: options.timeoutMs ?? (Number(process.env.JOBBER_PORTAL_HEALTH_LOCK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    retryMs: options.retryMs ?? (Number(process.env.JOBBER_PORTAL_HEALTH_LOCK_RETRY_MS) || DEFAULT_RETRY_MS),
    staleMs: options.staleMs ?? (Number(process.env.JOBBER_PORTAL_HEALTH_LOCK_STALE_MS) || DEFAULT_STALE_MS),
    kind: 'portal-health',
    owner: { file: filePath },
    ensureParentDir: true,
  }, fn);
}
