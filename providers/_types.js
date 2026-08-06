// Type catalog for the provider plugin contract.
//
// This file is documentation-only — pure JSDoc @typedef annotations. The
// project is plain ESM JavaScript with no build step; provider authors can
// reference these types via `/** @typedef {import('./_types.js').Provider} Provider */`
// at the top of a `// @ts-check`-enabled file to get IDE hints. The runtime
// contract is enforced by scan.mjs (id presence, fetch is a function, fetch
// returns an array), not by these annotations.
//
// Files prefixed with _ are never loaded as providers by scan.mjs.

/**
 * Normalized job posting — the unit of currency throughout the scanner.
 *
 * @typedef {object} Job
 * @property {string} title    Required, non-empty after trim.
 * @property {string} url      Required, absolute URL — used as the dedup key.
 * @property {string} company  May be empty when the source can't expose it
 *                             at the list-page level; populated downstream.
 * @property {string} location May be empty.
 * @property {string} [description] Job description text, populated ONLY when the
 *                               provider's list payload carries it for free (no
 *                               extra per-job request — the scanner is zero-token).
 *                               Lever supplies it via `descriptionPlain`; most
 *                               providers omit it. Consumed by scan.mjs's
 *                               content_filter; an empty/absent value always
 *                               passes the filter.
 * @property {number} [postedAt] Epoch ms when the posting was published.
 *                               Omitted when the source doesn't expose a
 *                               usable date. scan.mjs ignores it; consumers
 *                               like scan-ats-full.mjs use it for recency
 *                               filtering.
 * @property {{min: (number|null), max: (number|null), currency: string}} [salary]
 *                               ANNUALIZED figures only — never a raw hourly,
 *                               monthly, or weekly rate. A provider whose source
 *                               quotes a non-annual interval MUST multiply before
 *                               returning; ashby.mjs's INTERVAL_MULTIPLIERS is the
 *                               reference implementation. Consumed by scan.mjs's
 *                               buildSalaryFilter, which compares against
 *                               portals.yml `salary_filter` — always annual. An
 *                               un-annualized value does not error: it silently
 *                               drops well-paid roles as "below minimum", and the
 *                               user never sees the posting to notice. Omit the
 *                               field entirely when the source exposes no salary;
 *                               an absent value always passes the filter.
 *                               KEY PRESENCE: when `salary` IS present, all three
 *                               keys are present. An unknown bound is `null` — never
 *                               0 (which reads as real comp data downstream) and
 *                               never an omitted key. An unknown currency is `''`.
 *                               A one-sided range may be handled either way and both
 *                               are contract-valid, so consumers MUST tolerate null:
 *                               ashby.mjs/wttj.mjs resolve the missing side to the
 *                               known bound (min===max), while agentic-jobs.mjs
 *                               leaves it null to preserve "no upper bound
 *                               published" as distinct from "upper equals lower".
 * @property {number} [trustScore] 0-100 trust score from _trust-validator.mjs.
 * @property {string[]} [trustFlags] Flags raised by trust validation (e.g.
 *                                   'invalid_url', 'suspicious_domain').
 * @property {'high'|'medium'|'low'} [trustLevel] Classification derived from
 *                                                 trustScore.
 */

/**
 * Result returned by the trust validator for a single job posting.
 *
 * @typedef {object} TrustResult
 * @property {number} score       0-100, where 100 = fully trusted.
 * @property {string[]} flags     Flags raised (e.g. 'invalid_url', 'suspicious_domain').
 * @property {'high'|'medium'|'low'} level  Classification: 90-100 high, 60-89 medium, 0-59 low.
 */

/**
 * Named/known fields of a `tracked_companies` entry. See {@link PortalEntry}
 * for the actual contract type — this typedef exists only so the index
 * signature can be layered on via intersection.
 *
 * @typedef {object} PortalEntryKnown
 * @property {string}             name             User-facing label; appears in logs and placeholders.
 * @property {boolean}            [enabled]        Default: true.
 * @property {string}             [careers_url]    Public listing URL; consumed by detect().
 * @property {string}             [api]            JSON API URL; used directly by greenhouse/ashby providers.
 * @property {string}             [provider]       Explicit provider id — bypasses detect().
 * @property {('http')}           [transport]      Default: 'http'. Reserved for future transports.
 * @property {number}             [max_pages]      Provider-specific pagination cap (avature, workday).
 * @property {string}             [offset_param]   avature only: pins the pagination query key and disables the
 *                                                 provider's jobOffset→offset self-heal. Rarely needed — an
 *                                                 escape hatch for a tenant the auto-switch can't resolve.
 */

/**
 * A single `tracked_companies` entry from `portals.yml`.
 *
 * Provider-specific fields are opaque to scan.mjs and validated by the
 * provider itself. Examples in current providers: `api`, `careers_url`,
 * plus per-provider extras (e.g. `keywords`, `sfVariant`, `siteKey`).
 * Providers read these directly off the entry object — no schema enforcement
 * at the framework level. The index signature reflects that: known fields
 * stay typed, anything else is `any` by design.
 *
 * @typedef {PortalEntryKnown & Object.<string, any>} PortalEntry
 */

/**
 * Returned by `detect()` when a provider claims an entry. `url` is
 * informational (used in logs); routing only checks for a non-null return.
 *
 * @typedef {object} DetectHit
 * @property {string} url
 */

/**
 * Options forwarded to the underlying `fetch` call.
 *
 * @typedef {object} FetchOptions
 * @property {number}                [timeoutMs]
 * @property {Object<string,string>} [headers]
 * @property {string}                [method]
 * @property {(string|null)}         [body]
 * @property {('error'|'follow'|'manual')} [redirect]
 */

/**
 * What scan.mjs hands to provider.fetch(). For Phase A only `transport: 'http'`
 * is implemented; the shape reserves room for future transports without
 * breaking the contract.
 *
 * @typedef {object} Context
 * @property {('http')} transport
 * @property {(url: string, opts?: FetchOptions) => Promise<string>}  fetchText
 * @property {(url: string, opts?: FetchOptions) => Promise<unknown>} fetchJson
 * @property {number} [maxPages] Optional pagination hint. When set (verify-portals.mjs's
 *                              health probe passes 1), a paginating provider SHOULD stop
 *                              after this many pages — the probe only needs the first page
 *                              to tell a live board from a broken one, and must not walk an
 *                              entire careers site. Providers that ignore it stay correct:
 *                              the probe caps their requests defensively via the context's
 *                              own fetch functions.
 * @property {(ms: number) => Promise<void>} [sleep] Optional cross-provider pacing hook used by
 *                              paginating providers (avature, workday) to throttle between page
 *                              requests. May be absent — providers fall back to a native
 *                              `setTimeout`-based delay.
 */

/**
 * The provider contract — the default export of every providers/*.mjs file
 * (excluding _-prefixed shared helpers).
 *
 * @typedef {object} Provider
 * @property {string} id                                                       Unique across all loaded providers.
 * @property {((entry: PortalEntry) => (DetectHit | null))} [detect]           Optional auto-detection.
 * @property {(entry: PortalEntry, ctx: Context) => Promise<Job[]>} fetch      Required.
 * @property {((job: Job, ctx: Context) => Promise<void>)} [enrichDate]        Optional deferred-date
 *           hook for sources whose list page carries no publish date (icims.mjs is the
 *           reference implementation, fetching the detail page's JSON-LD). Called generically
 *           by scan-ats-full.mjs when present and the job is otherwise undated; mutates `job`
 *           in place by setting `postedAt`. Errors are swallowed by the caller — a provider
 *           whose enrichDate throws leaves the job undated, never failing the scan.
 */

export {};
