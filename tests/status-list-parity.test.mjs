// tests/status-list-parity.test.mjs — Phase 1.2 of the state-machine plan.
//
// test-all.mjs 55.3b checks that the WEB status lists carry every canonical
// state from templates/states.yml. This extends the same idea to the root
// scripts and the Go dashboard: each one hard-codes its own canonical labels
// and alias→state map, so each is compared to states.yml as a set of
// (key → canonical id) pairs, where key is a label or alias, lower-cased.
//
// Differences that exist today are pinned in ALLOWLIST below. The test fails on
// (a) a difference that is not pinned, and (b) a pinned difference that no
// longer exists, so the allowlist can only shrink. Each entry is a string:
//   +key=>state   the file accepts a key states.yml does not define
//   ~key=>state   the file maps a key states.yml maps to a different state
//   -key          the file does not accept an alias states.yml defines
//                 (canonical labels are exempt: scripts match them
//                 case-insensitively without listing them)
//   !key=>a|b     the file maps one key to two states internally
//
// LIMITS (static text check, AGENTS.md absence-check rule): extraction reads
// object literals, identity arrays, `.test(...)` regex alternations on lines
// that return a canonical state, `case` literals in Go's NormalizeStatus, and
// the i18n/filter lists in pipeline.go. A mapping written in another shape is
// invisible to it, and a determined rewrite can still evade a static list of
// this kind. The extractors throw when their anchors are missing, so a
// renamed block fails loudly instead of passing empty.
//
// NOTE: the fixtures in the self-check below are built by concatenation so this
// file does not match its own subject.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { load as yamlLoad } from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';

// ── Pinned differences (derived by running the comparison, Phase 1.2) ───────
const ALLOWLIST = {
  'merge-tracker.mjs': [
    '+condicional=>evaluated',
    '+dup=>discarded',
    '+duplicado=>discarded',
    '+evaluar=>evaluated',
    '+geo blocker=>skip',
    '+hold=>evaluated',
    '+repost=>discarded',
    '+verificar=>evaluated',
  ],
  'normalize-statuses.mjs': [
    '+-=>discarded',
    '+=>discarded',
    '+condicional=>evaluated',
    '+evaluar=>evaluated',
    '+geo blocker=>skip',
    '+hold=>evaluated',
    '+repost=>discarded',
    '+verificar=>evaluated',
    '+—=>discarded',
  ],
  'verify-pipeline.mjs': [
    '+condicional=>evaluated',
    '+evaluar=>evaluated',
    '+geo blocker=>skip',
    '+hold=>evaluated',
    '+verificar=>evaluated',
  ],
  'stats.mjs': [
    '+condicional=>evaluated',
    '+evaluar=>evaluated',
    '+geo blocker=>skip',
    '+hold=>evaluated',
    '+verificar=>evaluated',
    '-accept',
    '-accepted',
    '-contratada',
    '-contratado',
  ],
  'followup-cadence.mjs': [
    '+condicional=>evaluated',
    '+evaluar=>evaluated',
    '+geo blocker=>skip',
    '+hold=>evaluated',
    '+verificar=>evaluated',
    '-accept',
    '-accepted',
    '-contratada',
    '-contratado',
  ],
  'analyze-patterns.mjs': [
    '+condicional=>evaluated',
    '+evaluar=>evaluated',
    '+geo blocker=>skip',
    '+hold=>evaluated',
    '+verificar=>evaluated',
  ],
  'dashboard/internal/data/career.go': [
    '+basvuruldu=>applied',
    '+başvuruldu=>applied',
    '+condicional=>evaluated',
    '+degerlendirildi=>evaluated',
    '+değerlendirildi=>evaluated',
    '+dup=>discarded',
    '+duplicado=>discarded',
    '+evaluar=>evaluated',
    '+geo blocker=>skip',
    '+hold=>evaluated',
    '+iptal edildi=>discarded',
    '+iptal_edildi=>discarded',
    '+ise alindi=>hired',
    '+işe alındı=>hired',
    '+kabul edildi=>hired',
    '+kabul_edildi=>hired',
    '+mulakat=>interview',
    '+mülakat=>interview',
    '+reddedildi=>rejected',
    '+teklif=>offer',
    '+uygun degil=>skip',
    '+uygun değil=>skip',
    '+uygun_degil=>skip',
    '+uygun_değil=>skip',
    '+verificar=>evaluated',
    '+yanit verildi=>responded',
    '+yanit_verildi=>responded',
    '+yanıt verildi=>responded',
    '+yanıt_verildi=>responded',
    '+ıptal edildi=>discarded',
    '+ıptal_edildi=>discarded',
    '~monitor=>evaluated',
  ],
  'dashboard/internal/ui/screens/pipeline.go': [
    '+all=>all',
    '+top=>top',
  ],
};

// ── Extractors ──────────────────────────────────────────────────────────────
const CANON_IDS = new Set(['evaluated', 'applied', 'responded', 'interview', 'offer', 'hired', 'rejected', 'discarded', 'skip']);

function block(src, start, end) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`anchor not found: ${JSON.stringify(start)}`);
  const j = src.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`block end not found after ${JSON.stringify(start)}`);
  return src.slice(i, j + end.length);
}

const quoted = (text) => [...text.matchAll(/(['"])([^'"\n]*)\1/g)].map((m) => m[2]);

// `'key': 'State'` pairs inside an object literal.
function objectPairs(text) {
  return [...text.matchAll(/['"]([^'"\n]+)['"]\s*:\s*['"]([A-Za-z_]+)['"]/g)].map((m) => [m[1].toLowerCase(), m[2].toLowerCase()]);
}

// Every quoted item of an identity list maps to itself.
const identity = (text) => quoted(text).map((k) => [k.toLowerCase(), k.toLowerCase()]);

// Line-level mappings: a line that returns a canonical state (`return 'X'` or
// `status: 'X'`) maps the literals and `.test(...)` regex alternations on that
// same line to X. Lines returning a non-state ('positive', 'self_filtered') are ignored.
function lineTargets(src) {
  const pairs = [];
  for (const line of src.split('\n')) {
    const t = line.match(/(?:return\s+|status:\s*)['"]([A-Za-z_]+)['"]/);
    if (!t || !CANON_IDS.has(t[1].toLowerCase())) continue;
    const target = t[1].toLowerCase();
    const rest = line.replace(/(?:return\s+|status:\s*)['"][A-Za-z_]+['"]/, '');
    for (const k of quoted(rest)) pairs.push([k.toLowerCase(), target]);
    for (const m of rest.matchAll(/\/([^/\n]+)\/[gimsuy]*\.test\(/g)) {
      const toks = m[1].replace(/\\d\{4\}|\\d|\\s\+|\\s\*|\\s/g, ' ').replace(/\.\?/g, ' ')
        .replace(/[\^$()?]/g, '').split('|').map((x) => x.trim().toLowerCase());
      for (const k of toks) if (/^[a-z][a-z _-]*$/.test(k)) pairs.push([k, target]);
    }
  }
  return pairs;
}

// Go NormalizeStatus: inside `switch {`, the literals of every line accumulate
// until the next `return "state"`. Clauses wrap over several lines (the
// discarded clause does), so a per-line `case` match would miss aliases.
function goNormalizePairs(src) {
  const body = block(src, 'func NormalizeStatus(', '\n}\n');
  const pairs = [];
  let pending = [];
  let inSwitch = false;
  for (const raw of body.split('\n')) {
    const t = raw.trim();
    if (t === 'switch {') { inSwitch = true; continue; }
    if (!inSwitch) continue;
    const r = t.match(/^return\s+"([a-z]+)"$/);
    if (r) {
      for (const k of pending) pairs.push([k.toLowerCase(), r[1]]);
      pending = [];
      continue;
    }
    pending.push(...quoted(t));
  }
  return pairs;
}

// Go `case "x", "y":` lists in a function: identity.
function goCaseIdentity(src, header) {
  const body = block(src, header, '\n}\n');
  return body.split('\n').filter((l) => /^\s*case\s/.test(l)).flatMap((l) => identity(l));
}

// ── Per-file pair sets ──────────────────────────────────────────────────────
// CRLF-normalized: the Go sources are CRLF on Windows checkouts, and the block anchors use LF.
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');

// The alias map every JS script carries, plus anything it returns by line.
function jsAliasPairs(src, objectHeader) {
  return [...objectPairs(block(src, objectHeader, '};')), ...lineTargets(src)];
}

// A script that resolves statuses through the registry (lib/state-machine.mjs canonicalize)
// accepts every states.yml label/alias by construction, so its pair set is the whole of
// states.yml plus, only when it imports lib/status-extra-aliases.mjs, that table's
// spellings (pending decision D2). The extractor asserts the imports are really there:
// drop the registry call and this throws, so the script cannot pass on yml pairs it no
// longer uses. A hard-coded mapping added back to the script is still caught by lineTargets.
const { EXTRA_STATUS_ALIASES } = await import(pathToFileURL(join(ROOT, 'lib/status-extra-aliases.mjs')).href);
export function registryPairs(src, file, { extras = false } = {}) {
  if (!/from '\.\/lib\/state-machine\.mjs'/.test(src) || !/\bcanonicalize\(/.test(src)) {
    throw new Error(`${file} does not resolve statuses through lib/state-machine.mjs canonicalize`);
  }
  const pairs = [...ymlMap(yamlLoad(read('templates/states.yml'))).map];
  if (extras) {
    if (!/from '\.\/lib\/status-extra-aliases\.mjs'/.test(src) || !/\bextraStatusId\(/.test(src)) {
      throw new Error(`${file} does not fall back to lib/status-extra-aliases.mjs`);
    }
    pairs.push(...Object.entries(EXTRA_STATUS_ALIASES));
  }
  return pairs;
}

const SOURCES = {
  'merge-tracker.mjs': () => {
    const s = read('merge-tracker.mjs');
    return [...identity(block(s, 'const CANONICAL_STATES = [', '];')), ...jsAliasPairs(s, 'const aliases = {')];
  },
  'normalize-statuses.mjs': () => {
    const s = read('normalize-statuses.mjs');
    return [...identity(block(s, 'const canonical = [', '];')), ...lineTargets(s)];
  },
  'verify-pipeline.mjs': () => {
    const s = read('verify-pipeline.mjs');
    return [...identity(block(s, 'const CANONICAL_STATUSES = [', '];')), ...jsAliasPairs(s, 'const ALIASES = {')];
  },
  // stats.mjs keeps its own canonical list and delegates aliasing to
  // followup-cadence.mjs (`import { normalizeStatus }`), so both feed its set.
  'stats.mjs': () => {
    const s = read('stats.mjs');
    return [...identity(block(s, 'const CANONICAL_STATUSES = [', '];')), ...jsAliasPairs(read('followup-cadence.mjs'), 'const ALIASES = {')];
  },
  'followup-cadence.mjs': () => jsAliasPairs(read('followup-cadence.mjs'), 'const ALIASES = {'),
  'analyze-patterns.mjs': () => {
    const s = read('analyze-patterns.mjs');
    return [...identity(block(s, 'const FUNNEL_ORDER = [', '];')), ...registryPairs(s, 'analyze-patterns.mjs', { extras: true }), ...lineTargets(s)];
  },
  'dashboard/internal/data/career.go': () => {
    const s = read('dashboard/internal/data/career.go');
    return [
      ...goNormalizePairs(s),
      ...goCaseIdentity(s, 'func isCanonicalStatusValue('),
      ...goCaseIdentity(s, 'func StatusPriority('),
    ];
  },
  'dashboard/internal/ui/screens/pipeline.go': () => {
    const s = read('dashboard/internal/ui/screens/pipeline.go');
    const pairs = [...s.matchAll(/\{i18n\.Current\.\w+,\s*"([^"]+)"\}/g)].map((m) => [m[1].toLowerCase(), m[1].toLowerCase()]);
    const order = block(s, 'statusGroupOrder = []string{', '}');
    pairs.push(...identity(order));
    for (const m of s.matchAll(/^\s*filter\w+\s*=\s*"([^"]+)"/gm)) pairs.push([m[1].toLowerCase(), m[1].toLowerCase()]);
    return pairs;
  },
};

// ── Comparison ──────────────────────────────────────────────────────────────
// states.yml → key→state map (labels and aliases, lower-cased) and the label set.
export function ymlMap(statesDoc) {
  const map = new Map();
  const labels = new Set();
  for (const s of statesDoc.states) {
    const id = String(s.id).toLowerCase();
    const label = String(s.label).toLowerCase();
    map.set(label, id);
    labels.add(label);
    for (const a of s.aliases ?? []) map.set(String(a).toLowerCase(), id);
  }
  return { map, labels };
}

// pipeline.go lists only display labels, not aliases, so it is not held to the
// alias set; a conflicting label still counts.
const LABELS_ONLY = new Set(['dashboard/internal/ui/screens/pipeline.go']);

// Pure function so the self-check can exercise it on synthetic input.
export function diffPairs(pairs, yml, { aliases = true } = {}) {
  const seen = new Map();
  const out = [];
  for (const [k, v] of pairs) {
    if (seen.has(k) && seen.get(k) !== v) out.push(`!${k}=>${seen.get(k)}|${v}`);
    seen.set(k, v);
  }
  for (const [k, v] of seen) {
    if (!yml.map.has(k)) out.push(`+${k}=>${v}`);
    else if (yml.map.get(k) !== v) out.push(`~${k}=>${v}`);
  }
  const keys = new Set(seen.keys());
  if (aliases) {
    for (const [k] of yml.map) {
      if (!keys.has(k) && !yml.labels.has(k)) out.push(`-${k}`);
    }
  }
  return [...new Set(out)].sort();
}

// Pinned vs actual. Returns the new differences and the stale pins.
export function judge(actual, pinned) {
  const a = new Set(actual);
  const p = new Set(pinned);
  return {
    unpinned: actual.filter((d) => !p.has(d)),
    stale: pinned.filter((d) => !a.has(d)),
  };
}

// ── Self-check (control for the comparison itself) ─────────────────────────
// A synthetic file with a planted alias must produce a new difference, and a
// pin that no longer matches must be reported stale. Otherwise the live check
// could be silently inert.
const yml = ymlMap(yamlLoad(read('templates/states.yml')));
const planted = diffPairs([['evaluada', 'evaluated'], ['fake' + ' alias', 'evaluated']], yml);
if (judge(planted, []).unpinned.includes('+fake alias=>evaluated')) pass('parity self-check: a planted alias is reported as unpinned');
else fail('parity self-check: a planted alias was NOT reported — the live comparison would be inert');
if (judge([], ['+fake alias=>evaluated']).stale.length === 1) pass('parity self-check: a pin with no matching difference is reported stale');
else fail('parity self-check: a stale pin was NOT reported — the allowlist could grow without bound');

// Control for registryPairs: a script without the registry call must be rejected, one with it accepted.
const regSrc = "import { canonicalize } from './lib/state-machine.mjs'; canonicalize(m, x);";
let regRejected = false;
try { registryPairs('const x = 1;', 'fake.mjs'); } catch { regRejected = true; }
let regAccepted = false;
try { regAccepted = registryPairs(regSrc, 'fake.mjs').length > 0; } catch { /* stays false */ }
if (regRejected && regAccepted) pass('parity self-check: registryPairs rejects a script with no registry call and accepts one with it');
else fail(`parity self-check: registryPairs control failed (rejected=${regRejected}, accepted=${regAccepted})`);

// ── Live check ──────────────────────────────────────────────────────────────
for (const file of Object.keys(SOURCES)) {
  let actual;
  try {
    actual = diffPairs(SOURCES[file](), yml, { aliases: !LABELS_ONLY.has(file) });
  } catch (e) {
    fail(`${file}: could not extract its status list (${e.message})`);
    continue;
  }
  const { unpinned, stale } = judge(actual, ALLOWLIST[file] ?? []);
  for (const d of unpinned) fail(`${file}: new status-list difference not in ALLOWLIST: ${d}`);
  for (const d of stale) fail(`${file}: ALLOWLIST entry is stale (no longer a difference), remove it: ${d}`);
  if (unpinned.length === 0 && stale.length === 0) {
    pass(`${file}: status list matches states.yml except ${actual.length} pinned difference(s)`);
  }
}
