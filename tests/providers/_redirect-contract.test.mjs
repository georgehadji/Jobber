// tests/providers/_redirect-contract.test.mjs — every provider request refuses redirects.
//
// A provider's host allowlist only means something if a server-side redirect cannot walk the request
// off that host (blind SSRF). The contract is: every ctx.fetchJson / ctx.fetchText call passes
// `redirect: 'error'`, inline or through an options object declared in the same file. softgarden and
// csod broke it for a long time because nothing checked.
//
// This is a static scan of each provider's source. It is a tripwire for new providers, not a proof:
// a comment inside a call's arguments that spells the option could satisfy it, and a call built
// dynamically is invisible. The per-provider ats-ssrf-hardening tests are the behavioural side.
// Documented exceptions (self-hosted tenants whose requests follow a redirect by design) go in
// EXCEPTIONS with the reason; the list may only shrink.
import { pass, fail, ROOT } from '../helpers.mjs';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

console.log('\nProvider contract — every request refuses redirects');

const DIR = join(ROOT, 'providers');
// provider file -> reason its calls are allowed to omit redirect:'error'
const EXCEPTIONS = {
  // The request options arrive as a function parameter (invisible to this scan); every caller builds
  // them with redirect: 'error' (oraclecloud ~l.275, workday ~l.211, vdab ~l.213 - checked by hand).
  'oraclecloud.mjs': 'opts passed from callers that set redirect:error',
  'workday.mjs': 'opts passed from callers that set redirect:error',
  'vdab.mjs': 'opts spread from callers that set redirect:error',
};

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const REDIRECT_ERROR = /redirect\s*:\s*['"]error['"]/;

/** Calls `ctx.fetchJson(...)` / `ctx.fetchText(...)` with their balanced argument text. */
export function findFetchCalls(src) {
  const calls = [];
  const re = /\bctx\s*\.\s*fetch(?:Json|Text)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    let quote = null;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (quote) {
        if (c === BS) i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    calls.push({ line: src.slice(0, m.index).split(NL).length, text: src.slice(m.index, i) });
  }
  return calls;
}

/** Balanced {...} text starting at the first "{" at or after `from`. */
function braceBlock(src, from) {
  let i = src.indexOf('{', from);
  if (i < 0) return '';
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

/** Compliant = says redirect:'error' itself, or passes a variable whose object literal does. */
export function callRefusesRedirects(src, callText) {
  if (REDIRECT_ERROR.test(callText)) return true;
  const last = callText.match(/,\s*([A-Za-z_$][\w$]*)\s*\)$/);
  if (!last) return false;
  const decl = new RegExp(`(?:const|let|var)\\s+${last[1]}\\s*=\\s*`, 'g');
  let m;
  while ((m = decl.exec(src)) !== null) {
    if (REDIRECT_ERROR.test(braceBlock(src, m.index + m[0].length - 1))) return true;
  }
  return false;
}

// Self-test of the scanner: it must see compliant AND bare calls (run the control).
{
  const src = [
    "const good = { redirect: 'error' };",
    'const bad = { headers: {} };',
    "await ctx.fetchJson(a, { redirect: 'error' });",
    'await ctx.fetchText(b, { headers: {} });',
    'await ctx.fetchJson(c, good);',
    'await ctx.fetchJson(d, bad);',
  ].join(NL);
  const verdicts = findFetchCalls(src).map((c) => callRefusesRedirects(src, c.text));
  if (JSON.stringify(verdicts) === JSON.stringify([true, false, true, false])) pass('scanner tells compliant calls from bare ones, inline and through an options variable');
  else fail(`scanner self-test failed: ${JSON.stringify(verdicts)}`);
}

let callsSeen = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort()) {
  const src = readFileSync(join(DIR, file), 'utf8');
  const calls = findFetchCalls(src);
  callsSeen += calls.length;
  const bare = calls.filter((c) => !callRefusesRedirects(src, c.text));
  if (bare.length === 0) continue;
  if (EXCEPTIONS[file]) {
    pass(`providers/${file}: ${bare.length} call(s) without redirect:'error' are a documented exception (${EXCEPTIONS[file]})`);
    continue;
  }
  fail(`providers/${file}: request without redirect:'error' at line ${bare.map((c) => c.line).join(', ')}: ${bare[0].text.replace(/\s+/g, ' ').slice(0, 100)}`);
}
if (callsSeen > 50) pass(`scanned ${callsSeen} provider fetch calls`);
else fail(`scanner found only ${callsSeen} fetch calls - the pattern is broken`);
