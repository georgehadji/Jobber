// @ts-check
// core/shared/result.mjs — the Result type used across the pure domain core.
//
// Why a Result type rather than exceptions (POLYTONIC-PLAN §3.3): in this
// domain, failure is ordinary. A CV that will not parse, a posting that has
// been taken down, a model that returns unusable output — these are outcomes
// to handle, not crashes. Exceptions model the *exceptional*, and using them
// for the ordinary case has two concrete costs here:
//
//   1. A thrown value crossing an async boundary loses its call site, so the
//      only practical handler is a catch-all at the top of the request. That
//      is precisely where the context needed to explain the failure to a user
//      has already been discarded.
//   2. A function's signature stops telling you it can fail. `parseCv(text)`
//      returning `Result<CvDocument, ParseError>` is checkable by tsc under
//      the existing .typecheck-floor ratchet; `parseCv(text)` that throws is
//      not.
//
// So: `throw` stays reserved for programmer error — a contract violation, an
// impossible state, a bug. Everything a *user* can cause comes back as an err.
//
// Every error carries a stable `code`. The product ships 17 market modes; a
// message string cannot be localized downstream, a code can.
//
// Pure module: no side effects, no process.exit, no I/O at import.

/**
 * @template T, E
 * @typedef {{ ok: true, value: T } | { ok: false, error: E }} Result
 */

/**
 * @typedef {object} DomainError
 * @property {string} code - Stable, machine-readable. Never localized.
 * @property {string} message - Developer-facing English. Not shown to users raw.
 * @property {Record<string, unknown>} [details] - Structured context for the UI.
 */

/**
 * Wrap a successful value.
 *
 * @template T
 * @param {T} value
 * @returns {Result<T, never>}
 */
export function ok(value) {
  return { ok: true, value };
}

/**
 * Wrap a failure.
 *
 * @template E
 * @param {E} error
 * @returns {Result<never, E>}
 */
export function err(error) {
  return { ok: false, error };
}

/**
 * Build a DomainError, so every producer shapes them the same way.
 *
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {DomainError}
 */
export function domainError(code, message, details) {
  return details === undefined ? { code, message } : { code, message, details };
}

/**
 * @template T, E
 * @param {Result<T, E>} result
 * @returns {boolean}
 */
export function isOk(result) {
  return result.ok === true;
}

/**
 * @template T, E
 * @param {Result<T, E>} result
 * @returns {boolean}
 */
export function isErr(result) {
  return result.ok === false;
}

/**
 * Transform the success value, leaving a failure untouched.
 *
 * @template T, U, E
 * @param {Result<T, E>} result
 * @param {(value: T) => U} fn
 * @returns {Result<U, E>}
 */
export function map(result, fn) {
  if (result.ok) return ok(fn(result.value));
  return err(result.error);
}

/**
 * Transform the error, leaving a success untouched. Use when adding context as
 * an error travels outward through layers.
 *
 * @template T, E, F
 * @param {Result<T, E>} result
 * @param {(error: E) => F} fn
 * @returns {Result<T, F>}
 */
export function mapErr(result, fn) {
  if (result.ok) return ok(result.value);
  return err(fn(result.error));
}

/**
 * Chain an operation that itself returns a Result. This is what keeps a
 * multi-step pipeline flat instead of nesting one `if (r.ok)` per step.
 *
 * @template T, U, E, F
 * @param {Result<T, E>} result
 * @param {(value: T) => Result<U, F>} fn
 * @returns {Result<U, E | F>}
 */
export function flatMap(result, fn) {
  if (result.ok) return fn(result.value);
  return err(result.error);
}

/**
 * Read the value, substituting a default on failure.
 *
 * @template T, E
 * @param {Result<T, E>} result
 * @param {T} fallback
 * @returns {T}
 */
export function unwrapOr(result, fallback) {
  return result.ok ? result.value : fallback;
}

/**
 * Read the value, throwing on failure.
 *
 * Only for a call site that has already established the Result is ok, or where
 * a failure genuinely is a bug. Reaching for this to avoid handling an error is
 * how the Result type stops being worth having.
 *
 * @template T, E
 * @param {Result<T, E>} result
 * @returns {T}
 */
export function unwrap(result) {
  if (result.ok) return result.value;
  const error = result.error;
  // `in` narrowing rather than a cast: E is unconstrained, so asserting it is a
  // DomainError is a claim the compiler is right to reject.
  const detail = error !== null && typeof error === 'object' && 'code' in error && 'message' in error
    ? `${String(error.code)}: ${String(error.message)}`
    : String(error);
  throw new Error(`unwrap() on an err Result — ${detail}`);
}

/**
 * Collect an array of Results into a Result of an array, failing on the first
 * error (fail-fast).
 *
 * @template T, E
 * @param {Result<T, E>[]} results
 * @returns {Result<T[], E>}
 */
export function all(results) {
  const values = [];
  for (const result of results) {
    if (!result.ok) return err(result.error);
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Collect an array of Results, keeping every success and every failure.
 *
 * Distinct from `all` and both are needed: ingesting a CV wants to report all
 * eight malformed date fields at once, not make the user fix them one per
 * round-trip. Scoring wants to stop at the first failure.
 *
 * @template T, E
 * @param {Result<T, E>[]} results
 * @returns {{ values: T[], errors: E[] }}
 */
export function partition(results) {
  const values = [];
  const errors = [];
  for (const result of results) {
    if (result.ok) values.push(result.value);
    else errors.push(result.error);
  }
  return { values, errors };
}
