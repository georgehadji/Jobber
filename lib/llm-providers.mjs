/**
 * lib/llm-providers.mjs — SINGLE SOURCE OF TRUTH for LLM provider facts.
 *
 * Every default model id, base URL, env-var name, context window and price
 * lives here and NOWHERE else. Runners (`gemini-eval.mjs`, `openai-eval.mjs`,
 * `openai-tailor.mjs`, `ollama-eval.mjs`, `openrouter-runner.mjs`) and
 * `lib/token-tracker.mjs` import from this file — none of them may re-declare
 * a model name, key name or URL literal.
 *
 * Why: before this module the same default (`gemini-3.6-flash`, `gpt-4o-mini`)
 * was written in the runner, in the --help text, in `.env.example` and in the
 * token-tracker pricing fallback. They drifted — `gemini-eval.mjs` defaulted to
 * `gemini-3.6-flash` while its context-window comment still said
 * `gemini-2.5-flash`, a model that was deprecated 2026-06-17.
 *
 * Agent-side (CLI) spend-tier routing lives here too, as `SPEND_TIER_MODELS`.
 * `modes/_shared.md` restates that table in prose because the agent reads
 * markdown, and `batch/batch-runner.sh` shells out to the `--spend-tier` flag
 * below because bash cannot import an ES module — both are asserted against
 * this object in tests/llm-providers.test.mjs.
 */

import { pathToFileURL } from 'url';
import { realpathSync } from 'fs';

/** Output cap shared by every structured evaluation call (full 7-block report). */
export const MAX_OUTPUT_TOKENS = 8192;

/** Per-request wall-clock budget for an evaluation call, in ms. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

/**
 * @typedef {object} ProviderSpec
 * @property {string}  [defaultModel]       Model used when no env/flag override.
 * @property {string}  [defaultTailorModel] Override for CV tailoring (needs a smarter model).
 * @property {string}  [modelEnv]           Env var that pins the model.
 * @property {string}  [keyEnv]             Env var holding the API key.
 * @property {string}  [baseUrl]            Default API base URL.
 * @property {string}  [baseUrlEnv]         Env var that overrides `baseUrl`.
 * @property {string}  [timeoutEnv]         Env var that overrides `DEFAULT_REQUEST_TIMEOUT_MS`.
 * @property {number}  [contextTokens]      Input context window, for prompt budgeting.
 * @property {boolean} [free]               Always $0 (local inference) — never priced.
 * @property {boolean} [pricingOnly]        No runner ships a client; the entry exists for cost estimation.
 */

/** @type {Record<string, ProviderSpec>} */
export const PROVIDERS = {
  gemini: {
    // Gemini talks over the @google/generative-ai SDK, so there is no base URL here.
    defaultModel: 'gemini-3.6-flash',
    modelEnv: 'GEMINI_MODEL',
    keyEnv: 'GEMINI_API_KEY',
    contextTokens: 1_048_576,
  },

  openai: {
    defaultModel: 'gpt-4o-mini',
    defaultTailorModel: 'gpt-4o',
    modelEnv: 'OPENAI_MODEL',
    keyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    baseUrlEnv: 'OPENAI_BASE_URL',
    timeoutEnv: 'OPENAI_TIMEOUT_MS',
    contextTokens: 128_000,
  },

  ollama: {
    defaultModel: 'llama3.3',
    modelEnv: 'OLLAMA_MODEL',
    baseUrl: 'http://localhost:11434',
    baseUrlEnv: 'OLLAMA_BASE_URL',
    timeoutEnv: 'OLLAMA_TIMEOUT_MS',
    free: true, // local inference — estimateCost short-circuits to 0
  },

  openrouter: {
    // No defaultModel by design: the runner resolves free models live from the
    // API and rotates. JOBBER_MODEL pins one and skips rotation.
    modelEnv: 'JOBBER_MODEL',
    keyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
  },

  // Pricing-only entry: no runner ships a Claude HTTP client (the Claude Code
  // CLI is the Claude path), but cost estimation needs a fallback rate.
  claude: {
    defaultModel: 'claude-3-5-sonnet',
    keyEnv: 'ANTHROPIC_API_KEY',
    pricingOnly: true,
  },
};

/**
 * `spend_tier` (config/profile.yml) -> Claude Code model, for the batch worker.
 *
 * The prose version of this table lives in `modes/_shared.md` because the agent
 * reads markdown, not JS. This object is the machine-readable original; the
 * markdown row is asserted against it in tests/llm-providers.test.mjs, so the
 * two cannot drift silently. `batch/batch-runner.sh` reads it via
 * `node lib/llm-providers.mjs --spend-tier <tier>` rather than restating it.
 */
export const SPEND_TIER_MODELS = {
  economy: 'claude-haiku-4-5',
  standard: 'claude-sonnet-5',
  premium: 'claude-opus-5',
};

/** The tier used when `spend_tier` is absent or invalid. */
export const DEFAULT_SPEND_TIER = 'standard';

/**
 * @param {string} tier Requested spend tier.
 * @returns {string} Model id; falls back to the default tier's model.
 */
export function spendTierModel(tier) {
  return SPEND_TIER_MODELS[tier] ?? SPEND_TIER_MODELS[DEFAULT_SPEND_TIER];
}

/** Provider aliases accepted by callers (e.g. token-tracker's `provider` arg). */
const PROVIDER_ALIASES = { anthropic: 'claude' };

/**
 * @param {string} name Provider id or alias.
 * @returns {ProviderSpec|undefined}
 */
export function providerSpec(name) {
  return PROVIDERS[PROVIDER_ALIASES[name] ?? name];
}

/**
 * Resolve the model id for a provider: env override wins, then the default.
 *
 * @param {string} name Provider id.
 * @param {{ tailor?: boolean }} [opts] `tailor: true` prefers `defaultTailorModel`.
 * @returns {string|undefined} Model id, or undefined when the provider has no default.
 */
export function defaultModelFor(name, opts = {}) {
  const spec = providerSpec(name);
  if (!spec) return undefined;
  const fallback = opts.tailor ? (spec.defaultTailorModel ?? spec.defaultModel) : spec.defaultModel;
  return (spec.modelEnv ? process.env[spec.modelEnv] : '') || fallback;
}

/**
 * The model the user explicitly pinned via the provider's model env var, if any.
 * Distinct from `defaultModelFor`: this returns '' when nothing is pinned, which
 * is what openrouter's free-rotation logic branches on.
 *
 * @param {string} name Provider id.
 * @returns {string} Pinned model id, or '' when unpinned.
 */
export function pinnedModelFor(name) {
  const spec = providerSpec(name);
  return (spec?.modelEnv ? process.env[spec.modelEnv] : '') || '';
}

/**
 * Resolve a provider's base URL: env override wins. Trailing slash stripped so
 * callers can always concatenate `/path`.
 *
 * @param {string} name Provider id.
 * @returns {string} Normalized base URL ('' when the provider has none).
 */
export function baseUrlFor(name) {
  const spec = providerSpec(name);
  if (!spec) return '';
  const raw = (spec.baseUrlEnv ? process.env[spec.baseUrlEnv] : '') || spec.baseUrl || '';
  return raw.replace(/\/$/, '');
}

/**
 * Read a provider's API key from its declared env var.
 *
 * @param {string} name Provider id.
 * @returns {string} The key, or '' when unset or the provider needs none.
 */
export function apiKeyFor(name) {
  const spec = providerSpec(name);
  return (spec?.keyEnv ? process.env[spec.keyEnv] : '') || '';
}

/**
 * Per-request timeout in ms: the provider's env override, else the shared default.
 *
 * Throws rather than exiting so this module stays side-effect free; the three
 * runners that use it print the message and exit 1.
 *
 * @param {string} name Provider id.
 * @returns {number} Positive integer milliseconds.
 * @throws {Error} When the env var is set to something that isn't a positive integer.
 */
export function requestTimeoutMsFor(name) {
  const envVar = providerSpec(name)?.timeoutEnv;
  const raw = envVar ? process.env[envVar] : undefined;
  if (raw === undefined || raw === '') return DEFAULT_REQUEST_TIMEOUT_MS;
  const ms = parseInt(raw, 10);
  if (Number.isNaN(ms) || ms <= 0) {
    throw new Error(`Invalid ${envVar}: "${raw}" — must be a positive integer (milliseconds).`);
  }
  return ms;
}

/**
 * Input context window used to budget the prompt.
 *
 * @param {string} name Provider id.
 * @returns {number|undefined}
 */
export function contextTokensFor(name) {
  return providerSpec(name)?.contextTokens;
}

/**
 * USD per token, by model id. Paid-tier list prices; free tiers cost $0 and are
 * short-circuited by `estimateCost` in lib/token-tracker.mjs.
 */
export const RATES = {
  // OpenAI models
  'gpt-4o-mini': { input: 0.150 / 1000000, output: 0.600 / 1000000 },
  'gpt-4o': { input: 2.50 / 1000000, output: 10.00 / 1000000 },

  // Gemini models (Developer API paid tier, USD per token; free tier is $0)
  'gemini-3.6-flash': { input: 1.50 / 1000000, output: 7.50 / 1000000, cachedInput: 0.15 / 1000000 },
  'gemini-3.5-flash': { input: 1.50 / 1000000, output: 9.00 / 1000000, cachedInput: 0.15 / 1000000 },
  'gemini-2.5-flash': { input: 0.075 / 1000000, output: 0.300 / 1000000, cachedInput: 0.0375 / 1000000 },
  'gemini-2.5-pro': { input: 1.25 / 1000000, output: 5.00 / 1000000, cachedInput: 0.625 / 1000000 },

  // OpenRouter / DeepSeek models
  'deepseek/deepseek-chat': { input: 0.14 / 1000000, output: 0.28 / 1000000 },
  'deepseek-chat': { input: 0.14 / 1000000, output: 0.28 / 1000000 },
  'deepseek/deepseek-reasoner': { input: 0.55 / 1000000, output: 2.19 / 1000000 },
  'deepseek-reasoner': { input: 0.55 / 1000000, output: 2.19 / 1000000 },

  // Anthropic / Claude models
  'claude-3-5-sonnet': { input: 3.0 / 1000000, output: 15.0 / 1000000 },
  'claude-3-5-haiku': { input: 0.80 / 1000000, output: 4.00 / 1000000 },
  'claude-3-opus': { input: 15.00 / 1000000, output: 75.00 / 1000000 },
  'claude-3-haiku': { input: 0.25 / 1000000, output: 1.25 / 1000000 },
};

// ---------------------------------------------------------------------------
// Direct-execution shim: `node lib/llm-providers.mjs --spend-tier <tier>`
//
// Exists so batch/batch-runner.sh (bash — it cannot import an ES module) reads
// the tier table from here instead of restating it. Guarded on argv so the
// module stays side-effect free for every importer.
//
// realpathSync on argv[1] before comparing: import.meta.url is already
// symlink-resolved by Node's ESM loader, so on macOS (where /tmp -> /private/tmp)
// a raw argv[1] under os.tmpdir() never matches and this shim silently no-ops.
// ---------------------------------------------------------------------------
let invokedPath;
try { invokedPath = process.argv[1] && realpathSync(process.argv[1]); } catch { invokedPath = null; }
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const flagIndex = process.argv.indexOf('--spend-tier');
  if (flagIndex === -1) {
    process.stderr.write('usage: node lib/llm-providers.mjs --spend-tier <economy|standard|premium>\n');
    process.exit(2);
  }
  process.stdout.write(spendTierModel(process.argv[flagIndex + 1]));
}
