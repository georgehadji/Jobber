// utils/token-tracker.mjs — backward-compat re-export shim (#improvement-plan A7).
//
// token-tracker.mjs lives in lib/ now (pure importable module; no side effects
// at import time, no process.exit). This file is kept at the old path for one
// minor version so existing consumers keep resolving. Prefer importing directly
// from '../lib/token-tracker.mjs' in new code — this shim will be removed.
export {
  RATES,
  normalizeOpenAIUsage,
  estimateCost,
  TokenAccumulator,
  formatBreakdown,
} from '../lib/token-tracker.mjs';
