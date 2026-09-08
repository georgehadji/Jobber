#!/usr/bin/env node
/**
 * probe-providers.mjs — print the live OpenRouter provider pool behind each
 * HOSTED_ROUTES model (docs/HOSTED-APP-PLAN.md §5.3, "the plan's first build
 * task is a probe script that prints the post-filter pool per model").
 *
 * Honesty note: OpenRouter's per-model `/endpoints` listing does not expose
 * each provider's data-retention policy — `data_collection: deny` is a
 * per-REQUEST routing filter enforced server-side, not a static property this
 * script can read back. This prints the raw pool size (what routingFields()
 * routes across before that filter applies) and flags it as such, rather than
 * pretending to report a post-filter count it cannot actually verify.
 * A model whose raw pool drops to 1-2 providers loses its primary-slot
 * eligibility regardless (§5.3's third rule) — that's the number this script
 * can actually stand behind.
 *
 * Usage: node probe-providers.mjs
 */

import { HOSTED_ROUTES, OPENROUTER_HOST } from './lib/llm-providers.mjs';

const MIN_PROVIDERS_FOR_PRIMARY = 3;

function uniqueModels() {
  return [...new Set(Object.values(HOSTED_ROUTES).flat())];
}

/**
 * @param {string} modelId
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ id: string, providers: string[], error?: string }>}
 */
export async function probeModel(modelId, fetchImpl = fetch) {
  const url = `https://${OPENROUTER_HOST}/api/v1/models/${modelId}/endpoints`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { id: modelId, providers: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    const endpoints = data?.data?.endpoints ?? [];
    const providers = endpoints
      .map((e) => e.provider_name || e.tag || e.name || 'unknown')
      .filter(Boolean);
    return { id: modelId, providers };
  } catch (e) {
    return { id: modelId, providers: [], error: e.message };
  }
}

export async function probeAll(models = uniqueModels(), fetchImpl = fetch) {
  const results = [];
  for (const id of models) results.push(await probeModel(id, fetchImpl));
  return results;
}

async function main() {
  const workloadOf = new Map();
  for (const [workload, chain] of Object.entries(HOSTED_ROUTES)) {
    chain.forEach((id, i) => {
      const role = i === 0 ? 'primary' : i === chain.length - 1 ? 'floor' : 'fallback';
      const list = workloadOf.get(id) ?? [];
      list.push(`${workload}:${role}`);
      workloadOf.set(id, list);
    });
  }

  console.log('Provider pool per HOSTED_ROUTES model (raw pool, before OPENROUTER_DATA_COLLECTION=deny — see file header):\n');
  const results = await probeAll();
  let flagged = 0;
  for (const r of results) {
    const roles = (workloadOf.get(r.id) ?? []).join(', ');
    if (r.error) {
      console.log(`  ${r.id}  [${roles}]\n    could not probe: ${r.error}`);
      continue;
    }
    console.log(`  ${r.id}  [${roles}]\n    ${r.providers.length} provider(s): ${r.providers.join(', ') || '(none returned)'}`);
    const isPrimary = roles.includes(':primary');
    if (isPrimary && r.providers.length < MIN_PROVIDERS_FOR_PRIMARY) {
      flagged++;
      console.log(`    ⚠️  primary with only ${r.providers.length} provider(s) — below the ${MIN_PROVIDERS_FOR_PRIMARY}-provider bar §5.3 sets for a primary slot`);
    }
  }
  console.log(flagged === 0
    ? '\nEvery primary clears the provider-breadth bar.'
    : `\n${flagged} primary model(s) below the provider-breadth bar — see §5.3.`);
}

import { realpathSync } from 'fs';
import { pathToFileURL } from 'url';
let invokedPath;
try { invokedPath = process.argv[1] && realpathSync(process.argv[1]); } catch { invokedPath = null; }
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
