// tests/llm-providers.test.mjs — lib/llm-providers.mjs is the ONLY place a
// model id, provider key env var, or LLM base URL may be declared.
//
// Two halves:
//   1. Resolver behaviour (env override, tailor variant, URL normalization).
//   2. A drift guard that greps the runners for re-declared literals. This is
//      the half that actually enforces single-source-of-truth — without it the
//      next person adds `process.env.OPENAI_MODEL || 'gpt-5'` to one runner and
//      nothing notices until two files disagree.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import {
  PROVIDERS,
  RATES,
  MAX_OUTPUT_TOKENS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  SPEND_TIER_MODELS,
  DEFAULT_SPEND_TIER,
  spendTierModel,
  providerSpec,
  requestTimeoutMsFor,
  defaultModelFor,
  pinnedModelFor,
  baseUrlFor,
  apiKeyFor,
  contextTokensFor,
} from '../lib/llm-providers.mjs';

console.log('\nlib/llm-providers.mjs — single source of truth for LLM constants');

/** Run `fn` with `env` applied, restoring the previous values afterwards. */
function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

try {
  // ---- 1. Resolvers ------------------------------------------------------
  withEnv({ GEMINI_MODEL: undefined, OPENAI_MODEL: undefined, OLLAMA_MODEL: undefined }, () => {
    if (defaultModelFor('gemini') === PROVIDERS.gemini.defaultModel
        && defaultModelFor('openai') === PROVIDERS.openai.defaultModel
        && defaultModelFor('ollama') === PROVIDERS.ollama.defaultModel) {
      pass('defaultModelFor returns the declared default when no env is set');
    } else {
      fail('defaultModelFor did not return the declared defaults');
    }

    if (defaultModelFor('openai', { tailor: true }) === PROVIDERS.openai.defaultTailorModel
        && PROVIDERS.openai.defaultTailorModel !== PROVIDERS.openai.defaultModel) {
      pass('tailor:true selects defaultTailorModel (distinct from the eval default)');
    } else {
      fail('tailor variant did not resolve to defaultTailorModel');
    }
  });

  withEnv({ OPENAI_MODEL: 'some/pinned-model' }, () => {
    if (defaultModelFor('openai') === 'some/pinned-model'
        && defaultModelFor('openai', { tailor: true }) === 'some/pinned-model') {
      pass('the model env var overrides both the eval and tailor defaults');
    } else {
      fail('model env override did not win');
    }
  });

  withEnv({ JOBBER_MODEL: undefined }, () => {
    if (defaultModelFor('openrouter') === undefined && pinnedModelFor('openrouter') === '') {
      pass('openrouter has no default model (free rotation resolves live)');
    } else {
      fail('openrouter unexpectedly reports a default model');
    }
  });

  withEnv({ JOBBER_MODEL: 'vendor/model:free' }, () => {
    if (pinnedModelFor('openrouter') === 'vendor/model:free') {
      pass('pinnedModelFor reads the provider-declared model env var');
    } else {
      fail('pinnedModelFor did not read JOBBER_MODEL');
    }
  });

  withEnv({ OPENAI_BASE_URL: 'https://example.test/v1/' }, () => {
    if (baseUrlFor('openai') === 'https://example.test/v1') {
      pass('baseUrlFor applies the env override and strips the trailing slash');
    } else {
      fail(`baseUrlFor override/normalization failed: ${baseUrlFor('openai')}`);
    }
  });

  withEnv({ OPENAI_BASE_URL: undefined, OLLAMA_BASE_URL: undefined }, () => {
    if (baseUrlFor('openai') === PROVIDERS.openai.baseUrl
        && baseUrlFor('ollama') === PROVIDERS.ollama.baseUrl
        && baseUrlFor('gemini') === '') {
      pass('baseUrlFor falls back to the declared URL (and "" for SDK providers)');
    } else {
      fail('baseUrlFor default resolution failed');
    }
  });

  withEnv({ GEMINI_API_KEY: 'k-123' }, () => {
    if (apiKeyFor('gemini') === 'k-123') pass('apiKeyFor reads the declared key env var');
    else fail('apiKeyFor did not read GEMINI_API_KEY');
  });

  withEnv({ GEMINI_API_KEY: undefined }, () => {
    // Runners branch on `if (!apiKey)`; '' keeps that falsy without ever
    // producing an undefined that would poison a later `msg.split(apiKey)`.
    if (apiKeyFor('gemini') === '') pass('apiKeyFor returns "" (never undefined) when unset');
    else fail(`apiKeyFor unset should be "": ${JSON.stringify(apiKeyFor('gemini'))}`);
  });

  if (providerSpec('anthropic') === PROVIDERS.claude) {
    pass('providerSpec resolves the "anthropic" alias to the claude spec');
  } else {
    fail('anthropic alias did not resolve to claude');
  }

  if (contextTokensFor('gemini') > contextTokensFor('openai') && contextTokensFor('ollama') === undefined) {
    pass('contextTokensFor exposes per-provider windows');
  } else {
    fail('contextTokensFor returned unexpected values');
  }

  // Every provider that declares a default must be priceable, or cost
  // estimation silently falls back to "n/a" for the common path.
  const unpriced = Object.entries(PROVIDERS)
    .filter(([, spec]) => spec.defaultModel && !spec.free && !RATES[spec.defaultModel])
    .map(([name]) => name);
  if (unpriced.length === 0) {
    pass('every declared default model has a RATES entry');
  } else {
    fail(`default models missing from RATES: ${unpriced.join(', ')}`);
  }

  if (MAX_OUTPUT_TOKENS === 8192) pass('MAX_OUTPUT_TOKENS is the shared 8192 evaluation cap');
  else fail(`MAX_OUTPUT_TOKENS drifted: ${MAX_OUTPUT_TOKENS}`);

  withEnv({ OPENAI_TIMEOUT_MS: undefined }, () => {
    if (requestTimeoutMsFor('openai') === DEFAULT_REQUEST_TIMEOUT_MS
        && requestTimeoutMsFor('gemini') === DEFAULT_REQUEST_TIMEOUT_MS) {
      pass('requestTimeoutMsFor falls back to the shared default');
    } else {
      fail('requestTimeoutMsFor default resolution failed');
    }
  });

  withEnv({ OPENAI_TIMEOUT_MS: '1234' }, () => {
    if (requestTimeoutMsFor('openai') === 1234) pass('requestTimeoutMsFor honours the env override');
    else fail('requestTimeoutMsFor did not honour OPENAI_TIMEOUT_MS');
  });

  for (const bogus of ['0', '-5', 'abc']) {
    const threw = withEnv({ OPENAI_TIMEOUT_MS: bogus }, () => {
      try { requestTimeoutMsFor('openai'); return false; } catch { return true; }
    });
    if (!threw) { fail(`requestTimeoutMsFor accepted an invalid timeout: ${bogus}`); break; }
    if (bogus === 'abc') pass('requestTimeoutMsFor rejects zero, negative, and non-numeric values');
  }

  // ---- 2. Drift guard ----------------------------------------------------
  // Values the SSOT owns. Any of these appearing as a *quoted string literal*
  // in a runner means that runner re-declared it.
  const ownedLiterals = new Set();
  for (const spec of Object.values(PROVIDERS)) {
    for (const v of [spec.defaultModel, spec.defaultTailorModel, spec.baseUrl]) {
      if (v) ownedLiterals.add(v);
    }
  }
  const ownedEnvVars = new Set();
  for (const spec of Object.values(PROVIDERS)) {
    for (const v of [spec.modelEnv, spec.baseUrlEnv, spec.keyEnv, spec.timeoutEnv]) {
      if (v) ownedEnvVars.add(v);
    }
  }

  const RUNNERS = [
    'gemini-eval.mjs',
    'openai-eval.mjs',
    'openai-tailor.mjs',
    'ollama-eval.mjs',
    'openrouter-runner.mjs',
    'lib/token-tracker.mjs',
  ];

  const violations = [];
  for (const rel of RUNNERS) {
    const src = readFileSync(join(ROOT, rel), 'utf-8');
    for (const literal of ownedLiterals) {
      // Quoted only: help text and comments mention these in prose, and prose
      // that interpolates from the SSOT is exactly what we want to allow.
      if (src.includes(`'${literal}'`) || src.includes(`"${literal}"`)) {
        violations.push(`${rel}: re-declares "${literal}" — import it from lib/llm-providers.mjs`);
      }
    }
    for (const envVar of ownedEnvVars) {
      if (src.includes(`process.env.${envVar}`)) {
        violations.push(`${rel}: reads process.env.${envVar} directly — use the lib/llm-providers.mjs resolvers`);
      }
    }
  }
  if (violations.length === 0) {
    pass('no runner re-declares an SSOT-owned model id, base URL, or key env var');
  } else {
    fail(`single-source-of-truth violations:\n    ${violations.join('\n    ')}`);
  }

  // ---- 3. Docs stay in sync ---------------------------------------------
  // .env.example cannot import the SSOT, so assert it still quotes the current
  // values. Bumping a default without touching the docs reds this.
  const envExample = readFileSync(join(ROOT, '.env.example'), 'utf-8');
  const documented = [];
  for (const spec of Object.values(PROVIDERS)) {
    if (spec.pricingOnly) {
      // No runner reads it, so only the key env var is user-facing.
      if (spec.keyEnv) documented.push(spec.keyEnv);
      continue;
    }
    for (const v of [spec.defaultModel, spec.defaultTailorModel, spec.baseUrl,
                     spec.modelEnv, spec.baseUrlEnv, spec.keyEnv, spec.timeoutEnv]) {
      if (v) documented.push(v);
    }
  }
  const missingFromDocs = documented.filter(v => !envExample.includes(v));
  if (missingFromDocs.length === 0) {
    pass('.env.example documents every current default and env var name');
  } else {
    fail(`.env.example is stale — missing: ${missingFromDocs.join(', ')}`);
  }
  // ---- 4. Spend-tier table has exactly one source -------------------------
  if (spendTierModel('economy') === SPEND_TIER_MODELS.economy
      && spendTierModel('premium') === SPEND_TIER_MODELS.premium
      && spendTierModel('nonsense') === SPEND_TIER_MODELS[DEFAULT_SPEND_TIER]
      && spendTierModel('') === SPEND_TIER_MODELS[DEFAULT_SPEND_TIER]) {
    pass('spendTierModel maps each tier and falls back to the default tier');
  } else {
    fail('spendTierModel resolution failed');
  }

  // batch-runner.sh must call the SSOT, not restate the table in bash.
  const batchRunner = readFileSync(join(ROOT, 'batch', 'batch-runner.sh'), 'utf-8');
  const bashRestates = Object.values(SPEND_TIER_MODELS).filter(m => batchRunner.includes(`"${m}"`));
  if (bashRestates.length === 0 && batchRunner.includes('--spend-tier')) {
    pass('batch-runner.sh reads the tier table from lib/llm-providers.mjs');
  } else {
    fail(`batch-runner.sh re-declares tier models: ${bashRestates.join(', ') || '(missing --spend-tier call)'}`);
  }

  // modes/_shared.md is agent-facing prose and cannot import; assert it quotes
  // the same ids so the doc and the code can never disagree silently.
  const shared = readFileSync(join(ROOT, 'modes', '_shared.md'), 'utf-8');
  const missingFromShared = Object.values(SPEND_TIER_MODELS).filter(m => !shared.includes(m));
  if (missingFromShared.length === 0) {
    pass('modes/_shared.md tier table matches SPEND_TIER_MODELS');
  } else {
    fail(`modes/_shared.md is stale — missing: ${missingFromShared.join(', ')}`);
  }
} catch (e) {
  fail(`llm-providers tests crashed: ${e.stack || e.message}`);
}
