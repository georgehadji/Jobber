/**
 * tracker-utils.mjs — shared helpers for rewriting `data/applications.md` rows.
 *
 * The tracker is a markdown table that several scripts mutate in place
 * (`dedup-tracker.mjs`, `normalize-statuses.mjs`, `merge-tracker.mjs`,
 * `set-status.mjs`). Keeping the row-rewrite, path-resolution, locking, and
 * atomic-write logic here means a fix lands once instead of drifting between
 * copies — and every writer excludes every other writer through the same lock.
 */

import { readFileSync, writeFileSync, renameSync, rmSync, existsSync, realpathSync, appendFileSync } from 'fs';
import { join, dirname, basename, resolve, relative, isAbsolute, sep } from 'path';
import { createHash, randomUUID } from 'crypto';
import { tmpdir } from 'os';
import yaml from 'js-yaml';

/**
 * Rebuild a markdown table row from the cells produced by `line.split('|')`.
 *
 * `split('|')` yields a leading empty element (before the opening `|`) and,
 * when the row ends with a trailing `|`, a trailing empty element too. A naive
 * `slice(1, -1)` assumes that trailing empty always exists — but a row written
 * without a trailing pipe (`| 5 | … | note`, still a valid row) keeps its real
 * last cell (the notes) at the end, so `slice(1, -1)` silently drops it. Here we
 * drop the leading empty and only drop a trailing element when it is genuinely
 * empty, preserving every real cell regardless of trailing-pipe style (and
 * tolerating extra columns like a custom Location).
 *
 * @param {string[]} parts - Trimmed cells from `line.split('|').map(s => s.trim())`.
 * @returns {string} The rebuilt `| a | b | … |` row.
 */
export function rebuildRow(parts) {
  const cells = parts.slice(1);
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return '| ' + cells.join(' | ') + ' |';
}

/**
 * Normalize company names for same-company lookups across tracker scripts.
 *
 * Company names can contain spaces, punctuation, or branding variants in the
 * tracker and incoming rows. Removing non-alphanumeric characters gives every
 * consumer (merge-tracker dedup, set-status row resolution) the same stable
 * company key, so a row one script would match is never missed by another.
 *
 * @param {string} name - Company name from the tracker or an input row.
 * @returns {string} Lowercase alphanumeric company key.
 */
export function normalizeCompany(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Neutralize characters that would corrupt the applications.md table.
 *
 * Tracker rows are read with a raw `line.split('|')`, so a literal pipe or a
 * newline in a free-text value (company/role/location/notes) would shift every
 * later column. Replace rather than backslash-escape: `\|` would still split
 * on the inner pipe. Additive — normal cells are unchanged; only values that
 * would already break the table get sanitized.
 *
 * @param {*} v - Free-text value headed for a table cell.
 * @returns {string} Table-safe value.
 */
export function cell(v) {
  return String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\s*\|\s*/g, ' / ').trim();
}

/**
 * Resolve the tracker file path for the current workspace.
 *
 * Supports both layouts: `data/applications.md` (boilerplate) and
 * `applications.md` (original root layout). The `JOBBER_TRACKER` env var
 * overrides the path (used by tests and non-standard layouts). The result is
 * canonicalized so every script that locks or hashes the tracker path agrees
 * on one spelling.
 *
 * @param {string} rootDir - The Jobber repository root.
 * @returns {string} Absolute canonical tracker path.
 */
export function resolveTrackerPath(rootDir) {
  const raw = process.env.JOBBER_TRACKER
    ? process.env.JOBBER_TRACKER
    : existsSync(join(rootDir, 'data/applications.md'))
      ? join(rootDir, 'data/applications.md')
      : join(rootDir, 'applications.md');
  return canonicalizeTrackerPath(raw);
}

/**
 * Convert the tracker path into one stable absolute spelling before hashing it.
 *
 * Equivalent tracker paths can be written in multiple ways, such as a relative
 * path from the current shell, an absolute path, or a path that travels through
 * a symlink. The lock key must be based on one canonical spelling so all
 * processes that target the same tracker also target the same lock directory.
 *
 * @param {string} path - Raw tracker path from config, env, or the default.
 * @returns {string} Absolute canonical path when the file exists, else resolved path.
 */
export function canonicalizeTrackerPath(path) {
  const absolutePath = resolve(path);
  try {
    return realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

/**
 * Check whether one absolute path stays inside another directory.
 *
 * This protects recursive lock cleanup from accepting paths that escape the
 * system temp directory through `..` segments or unrelated absolute roots.
 *
 * @param {string} childPath - Candidate path to validate.
 * @param {string} parentDir - Required parent directory boundary.
 * @returns {boolean} True when childPath is inside parentDir or equal to it.
 */
function pathIsInside(childPath, parentDir) {
  const relativePath = relative(parentDir, childPath);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

/**
 * Compute the tracker lock directory for a tracker file.
 *
 * The lock name is derived from a hash of the canonical tracker path, so every
 * writer (`merge-tracker.mjs`, `set-status.mjs`) that targets the same tracker
 * contends on the same lock. `JOBBER_TRACKER_LOCK` exists for tests and
 * unusual local layouts, but lock directories are removed recursively, so
 * env-provided paths must be absolute, live under the OS temp directory, and
 * use the Jobber lock-name prefix. Invalid values are ignored and the
 * deterministic temp-dir default is used instead.
 *
 * @param {string} appsFile - Canonical tracker path (see canonicalizeTrackerPath).
 * @returns {string} Safe lock directory path.
 */
export function trackerLockDirFor(appsFile) {
  const lockKey = createHash('sha256').update(appsFile).digest('hex').slice(0, 16);
  const tmpRoot = realpathSync(tmpdir());
  const fallback = join(tmpRoot, `jobber-merge-tracker-${lockKey}.lock`);
  const envValue = process.env.JOBBER_TRACKER_LOCK;
  if (!envValue || !isAbsolute(envValue)) return fallback;

  const candidate = resolve(envValue);
  const parentDir = dirname(candidate);
  const canonicalParent = existsSync(parentDir) ? realpathSync(parentDir) : resolve(parentDir);
  if (!pathIsInside(canonicalParent, tmpRoot)) return fallback;
  if (!basename(candidate).startsWith('jobber-merge-tracker-')) return fallback;
  return candidate;
}

/**
 * Acquire an exclusive filesystem lock for one tracker mutation.
 *
 * The critical section must cover the full read/modify/write/move sequence, not
 * just the final write. Otherwise two processes can read the same old tracker
 * snapshot, compute independent updates, and let the later writer erase rows
 * written by the earlier one. The lock is implemented with atomic directory
 * creation, owner metadata, retry/backoff, stale-owner recovery, and a release
 * token so one process cannot delete another process's newer lock.
 *
 * @param {string} lockDir - Directory path used as the lock sentinel.
 * @param {object} [options] - Lock timing options.
 * @param {number} [options.timeoutMs=60000] - Maximum time to wait for the lock.
 * @param {number} [options.retryMs=75] - Delay between acquisition attempts.
 * @param {number} [options.staleMs=600000] - Metadata-free stale-lock threshold, floored at OWNERLESS_GRACE_MS.
 * @param {string} [options.tracker] - Tracker path recorded in owner metadata.
 * @param {Function} [options.removeLock] - Release hook for deterministic fault tests.
 * @returns {Promise<{attempts:number,waitMs:number,staleRecovered:boolean,release:Function}>}
 * Lock handle with metadata and an idempotent release method.
 */
export async function acquireTrackerLock(lockDir, options = {}) {
  // The tracker lock is the hardened reference implementation, now extracted
  // once into lib/file-lock.mjs (#improvement-plan A2). This is a thin shim:
  // it records the tracker path as the owner field, honors the env overrides
  // (tests tune contention per-process), and re-tags the timeout error with
  // `.code = 'LOCK_TIMEOUT'` — the marker callers (set-status.mjs etc.) use to
  // tell "lock busy, retry later" apart from filesystem failures.
  const { acquireLock } = await import('./lib/file-lock.mjs');
  try {
    return await acquireLock('', {
      lockDir,
      timeoutMs: options.timeoutMs ?? (Number(process.env.JOBBER_TRACKER_LOCK_TIMEOUT_MS) || 60_000),
      retryMs: options.retryMs ?? (Number(process.env.JOBBER_TRACKER_LOCK_RETRY_MS) || 75),
      staleMs: options.staleMs ?? (Number(process.env.JOBBER_TRACKER_LOCK_STALE_MS) || 10 * 60_000),
      kind: 'tracker',
      owner: { tracker: options.tracker ?? '' },
      removeLock: options.removeLock,
    });
  } catch (err) {
    if (err?.name === 'LockTimeoutError') {
      // Preserve the legacy marker consumers branch on (set-status.mjs checks
      // err.code === 'LOCK_TIMEOUT' → exit 4 / 'lock-timeout').
      err.code = 'LOCK_TIMEOUT';
      throw err;
    }
    throw err;
  }
}

/**
 * Open one serialized read/replace transaction for an applications tracker.
 * Writers receive only the canonical path plus guarded read and atomic replace
 * operations, keeping the complete mutation inside one shared lock lifetime.
 */
export async function openTrackerTransaction(appsFile, options = {}) {
  const trackerPath = canonicalizeTrackerPath(appsFile);
  const { lockDir = trackerLockDirFor(trackerPath), ...lockOptions } = options;
  const lock = await acquireTrackerLock(lockDir, {
    timeoutMs: Number(process.env.JOBBER_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.JOBBER_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.JOBBER_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: trackerPath,
    ...lockOptions,
  });
  let closed = false;
  let closeError = null;
  const assertOpen = () => {
    if (closed) throw new Error('Tracker transaction is already closed');
  };
  return {
    path: trackerPath,
    read() {
      assertOpen();
      return readFileSync(trackerPath, 'utf-8');
    },
    replace(content) {
      assertOpen();
      writeFileAtomic(trackerPath, content);
    },
    close() {
      if (closed) return closeError;
      try {
        lock.release();
      } catch (err) {
        closeError = err;
        console.error(`Warning: tracker transaction closed but lock cleanup failed at ${lockDir}: ${err.message}`);
      } finally {
        closed = true;
      }
      return closeError;
    },
  };
}

/**
 * Replace a tracker file atomically using a same-directory temporary file.
 *
 * Writing into the same directory keeps the final `renameSync` atomic on normal
 * filesystems and avoids exposing a partially written `applications.md` to other
 * readers. If the write or rename fails, the temporary file is cleaned up before
 * the original error is rethrown.
 *
 * @param {string} path - Final file path to replace.
 * @param {string} content - Complete file content to write.
 * @returns {void}
 */
export function writeFileAtomic(path, content) {
  const tmpPath = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, path);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
}

/**
 * Format one status-log.tsv line (append-only transition ledger).
 *
 * Every tracker writer that changes a row's state should append here — not
 * just set-status.mjs (#improvement-plan A4(b)) — so funnel-velocity.mjs has a
 * complete, dated event log. The ledger sits beside the tracker file it
 * describes (deriving its path from the tracker path keeps JOBBER_TRACKER
 * redirects in tests/custom layouts working).
 *
 * Line format: {tracker#}\t{date}\t{from}\t{to}\t{source}\t{note}
 * `from` may be '-' when the prior state is unknown (a freshly created row);
 * `to` = '-' retracts the row's latest observation. Sources follow
 * funnel-velocity.mjs's VALID_SOURCES contract: set-status | correction |
 * backfill | manual (only set-status/correction feed day-math).
 *
 * @param {string} trackerPath - Canonical active tracker path (see resolveTrackerPath).
 * @param {object} entry - Ledger entry fields.
 * @param {string|number} entry.num - Tracker row number.
 * @param {string} entry.date - Event date as YYYY-MM-DD.
 * @param {string} entry.from - Prior state label, or '-' when unknown.
 * @param {string} entry.to - New state label, or '-' to retract.
 * @param {string} entry.source - Valid source tag (see above; default 'set-status').
 * @param {string} [entry.note] - Optional one-line note.
 * @returns {void}
 */
export function appendStatusLog(trackerPath, entry) {
  const { num, date, from, to, source = 'set-status', note = '' } = entry;
  const logPath = join(dirname(trackerPath), 'status-log.tsv');
  const line = `${num}\t${date}\t${from}\t${to}\t${source}\t${cell(note)}\n`;
  appendFileSync(logPath, line);
}

/**
 * Load the canonical tracker states from `templates/states.yml`.
 *
 * states.yml is the single source of truth for the 8 canonical states and
 * their aliases. Parsing it here (instead of hardcoding the list) means a new
 * state or alias lands in one file and every consumer follows.
 *
 * @param {string} statesPath - Path to templates/states.yml.
 * @returns {{id:string,label:string,aliases:string[]}[]} Parsed state entries.
 */
export function loadCanonicalStates(statesPath) {
  const doc = yaml.load(readFileSync(statesPath, 'utf-8'));
  if (!doc || !Array.isArray(doc.states)) {
    throw new Error(`Malformed states file at ${statesPath}: expected a top-level "states" list`);
  }
  return doc.states.map(s => ({
    id: String(s.id ?? ''),
    label: String(s.label ?? ''),
    aliases: Array.isArray(s.aliases) ? s.aliases.map(String) : [],
  }));
}

/**
 * Load the legal status-transition table from `templates/states.yml`.
 *
 * `transitions` maps a source state id to the ids it may legally become
 * (#improvement-plan A4(a)). A state with no entry (or an empty list) is
 * terminal: it has no forward edges, so any change out of it is a correction
 * that must go through set-status's --force override. A client that only
 * read states via loadCanonicalStates keeps working unchanged.
 *
 * @param {string} statesPath - Path to templates/states.yml.
 * @returns {Record<string,string[]>} Source state id → allowed target state ids.
 */
export function loadStateTransitions(statesPath) {
  const doc = yaml.load(readFileSync(statesPath, 'utf-8'));
  const raw = doc && typeof doc.transitions === 'object' && doc.transitions !== null
    ? doc.transitions
    : {};
  const out = {};
  for (const [fromId, targets] of Object.entries(raw)) {
    out[fromId] = Array.isArray(targets) ? targets.map(String) : [];
  }
  return out;
}

/**
 * Whether a status transition is allowed by the states.yml table.
 *
 * @param {Record<string,string[]>} transitions - From loadStateTransitions().
 * @param {string} fromId - Source state id.
 * @param {string} toId - Target state id.
 * @returns {boolean} True when `toId` is an allowed target of `fromId`.
 */
export function canTransition(transitions, fromId, toId) {
  return Array.isArray(transitions[fromId]) && transitions[fromId].includes(toId);
}

/**
 * Resolve user input to a canonical state label, strictly.
 *
 * Case-insensitive match against each state's label, id, and aliases, after
 * stripping markdown bold. Unlike merge-tracker's lenient batch normalization
 * (which defaults unknowns to "Evaluated" so a whole merge isn't lost), this
 * is the strict variant for interactive/CLI use: unknown input returns null so
 * the caller can reject it before anything touches the tracker.
 *
 * @param {string} input - Raw state text from the user or a script.
 * @param {{id:string,label:string,aliases:string[]}[]} states - From loadCanonicalStates().
 * @returns {string|null} Canonical label (e.g. "Applied"), or null when unknown.
 */
export function resolveCanonicalState(input, states) {
  const clean = String(input ?? '').replace(/\*\*/g, '').trim().toLowerCase();
  if (!clean) return null;
  for (const s of states) {
    if (s.label.toLowerCase() === clean) return s.label;
    if (s.id.toLowerCase() === clean) return s.label;
    if (s.aliases.some(a => a.toLowerCase() === clean)) return s.label;
  }
  return null;
}
