// pipeline-lock.mjs — cross-process advisory lock for data/pipeline.md.
//
// This is now a thin facade over the single shared lock implementation in
// lib/file-lock.mjs (#improvement-plan A2). The pipeline lock's defaults match
// the original contract: a 30s stale window (vs. the tracker's 10 minutes —
// pipeline appends are short), the owner.json records the pipeline path, and
// the parent data/ directory is created for a fresh install (appendToPipeline
// is called before data/ necessarily exists).
//
// appendToPipeline() (scan.mjs) is a plain read-modify-write, exported and
// called from three places — scan.mjs, scan-ats-full.mjs, and plugins.mjs — so
// any two running concurrently must be excluded by one lock. All concurrency
// correctness lives in lib/file-lock.mjs now.

import { acquireLock, withLock, LockTimeoutError, OWNERLESS_GRACE_MS } from './lib/file-lock.mjs';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 80;
const DEFAULT_TIMEOUT_MS = 8_000;

export { OWNERLESS_GRACE_MS };
export { LockTimeoutError };

export function lockDirFor(pipelinePath) {
  return `${pipelinePath}.lock`;
}

/**
 * Blocks until the lock on `pipelinePath` is held, then returns a handle whose
 * release() frees it. Throws LockTimeoutError if the lock stays busy.
 *
 * @param {string} pipelinePath - File the lock guards.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=8000] - Max time to wait for the lock.
 * @param {number} [options.retryMs=80] - Delay between acquisition attempts.
 * @param {number} [options.staleMs=30000] - Age threshold for a lock with no readable owner, floored at OWNERLESS_GRACE_MS.
 */
export async function acquirePipelineLock(pipelinePath, options = {}) {
  return acquireLock(pipelinePath, {
    timeoutMs: options.timeoutMs ?? (Number(process.env.JOBBER_PIPELINE_LOCK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    retryMs: options.retryMs ?? (Number(process.env.JOBBER_PIPELINE_LOCK_RETRY_MS) || DEFAULT_RETRY_MS),
    staleMs: options.staleMs ?? (Number(process.env.JOBBER_PIPELINE_LOCK_STALE_MS) || DEFAULT_STALE_MS),
    kind: 'pipeline',
    owner: { pipeline: pipelinePath },
    ensureParentDir: true,
  });
}

/** Acquires the lock on `pipelinePath`, runs fn, and always releases it. */
export async function withPipelineLock(pipelinePath, fn, options = {}) {
  return withLock(pipelinePath, {
    timeoutMs: options.timeoutMs ?? (Number(process.env.JOBBER_PIPELINE_LOCK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    retryMs: options.retryMs ?? (Number(process.env.JOBBER_PIPELINE_LOCK_RETRY_MS) || DEFAULT_RETRY_MS),
    staleMs: options.staleMs ?? (Number(process.env.JOBBER_PIPELINE_LOCK_STALE_MS) || DEFAULT_STALE_MS),
    kind: 'pipeline',
    owner: { pipeline: pipelinePath },
    ensureParentDir: true,
  }, fn);
}
