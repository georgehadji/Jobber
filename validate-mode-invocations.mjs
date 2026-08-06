#!/usr/bin/env node
/**
 * validate-mode-invocations.mjs — cross-validate `node <script>.mjs` calls in
 * modes/*.md against the scripts that exist and the flags they support.
 *
 * The prompt layer (modes/*.md) is tightly coupled to the script layer: every
 * mode hardcodes literal `node <script>.mjs <flags>` invocations. When a
 * script's CLI changes, every mode (and every translation of that mode) that
 * calls it breaks silently — the AI agent reads a mode, runs the command, and
 * the command fails with an unfamiliar error. There was no gate watching for
 * that drift. This script is the gate.
 *
 * Validation tiers (progressive — never invent a signal):
 *   1. Script exists?            → ERROR (exit 1 in --ci). A mode referencing
 *                                  a deleted/renamed script is broken, period.
 *   2. Flags match --help?       → WARNING. Only checked when the script has a
 *                                  --help handler that prints flag names; a
 *                                  mode using a flag the script doesn't
 *                                  document is drift worth flagging.
 *   3. No --help support         → INFO. Cannot validate flags; existence is
 *                                  still checked. No noise, no false failure.
 *
 * Flag extraction is conservative: a token is a flag only if it starts with
 * `--` or `-` and is not a positional placeholder (`<report#>`, `{###}`,
 * `$VAR`). Positional args are ignored entirely.
 *
 * Output:
 *   --json     — { files, invocations, errors[], warnings[], infos[] }
 *   --summary  — human-readable lines (default)
 *   --ci       — exit 1 if any ERROR (missing script); warnings never fail
 *
 * Run:
 *   node validate-mode-invocations.mjs             (summary)
 *   node validate-mode-invocations.mjs --json
 *   node validate-mode-invocations.mjs --ci        (exit 1 on missing script)
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname, basename, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';

const JOBBER = dirname(fileURLToPath(import.meta.url));
const MODES_DIR = join(JOBBER, 'modes');
const JSON_OUT = process.argv.includes('--json');
const CI_MODE = process.argv.includes('--ci');

// A mode invocation looks like `node script.mjs --flag value`. The script
// name is the part right after `node ` — letters, digits, underscores, hyphens,
// dots. We deliberately do not match `npm run` (different resolution path).
// (Exported below alongside FLAG_RE for test coverage of the extraction path.)

// Flags are `--name` or `-x` tokens appearing in the invocation's line.
// Capture any `--word` / `-x` token (robust to `[--flag` and `(--flag`
// contexts in usage text); positional placeholders (<url>, {###}, $VAR) are
// not flags and are filtered by PLACEHOLDER_RE.
// Exported for tests to exercise edge cases directly.
export const FLAG_RE = /--[a-zA-Z0-9][a-zA-Z0-9-]*|-[a-zA-Z](?=\s|$)/g;
export const INVOCATION_RE = /node\s+([a-zA-Z0-9_-]+\.mjs)\b/g;
export const PLACEHOLDER_RE = /^[<{]/;

/**
 * Collect every `node <script>.mjs` invocation across a modes directory
 * (recursive — includes translations under modes/<lang>/ and skill dirs).
 *
 * @param {string} [modesDir] - Directory to walk; defaults to the repo modes/.
 * @returns {Array<{file: string, script: string, flags: string[]}>}
 */
export function collectInvocations(modesDir = MODES_DIR) {
  const invocations = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.md')) continue;
      const text = readFileSync(full, 'utf-8');
      for (const m of text.matchAll(INVOCATION_RE)) {
        const script = m[1];
        // Re-scan the line context for flags following this invocation.
        // m.index is absolute in `text`; offset it against the line slice
        // start so the matchAll scans the line-relative range. The capture
        // window is bounded by the next `node ` invocation on the same line
        // (a line can list several commands, e.g. pipeline mode's
        // "run merge-tracker.mjs, verify-pipeline.mjs, ..." — flags must
        // never leak across commands).
        const lineStart = text.lastIndexOf('\n', m.index) + 1;
        const lineEnd = text.indexOf('\n', m.index);
        const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
        const afterInvocation = line.slice(m.index - lineStart + script.length + 6);
        const nextInvocation = afterInvocation.search(/node\s+[a-zA-Z0-9_-]+\.mjs\b/);
        const flagWindow = nextInvocation === -1
          ? afterInvocation
          : afterInvocation.slice(0, nextInvocation);
        const flags = [];
        for (const fm of flagWindow.matchAll(FLAG_RE)) {
          const f = fm[0];
          if (PLACEHOLDER_RE.test(f)) continue;
          flags.push(f);
        }
        invocations.push({ file: full.replace(/\\/g, '/'), script, flags });
      }
    }
  };
  walk(modesDir);
  return invocations;
}

/**
 * Extract documented flag names from a script's --help output.
 *
 * @param {string} script - Script filename (e.g. `browser-extract.mjs`).
 * @returns {string[]|null} Flag names, or null when the script has no --help.
 */
function helpFlags(script) {
  const scriptPath = join(JOBBER, script);
  if (!existsSync(scriptPath)) return null;

  // T4: prefer the machine-readable --capabilities contract when the script
  // implements it. It is JSON, needs no parsing heuristics, and (unlike
  // --help probing) never pays a lazy-import or playwright cost for scripts
  // that gate it before their heavy imports. Fall back to --help parsing
  // when the script has no --capabilities handler.
  const capFlags = capabilitiesFlags(scriptPath);
  if (capFlags !== null) return capFlags;

  // Does the script even handle --help? Grep the source for a help branch —
  // cheaper than running every script, and avoids side effects.
  const src = readFileSync(scriptPath, 'utf-8');
  // Only probe scripts with a REAL --help branch. The naive `/['"]--help['"]/`
  // grep also matches scripts that merely STRIP --help from argv
  // (e.g. extract-latex-content.mjs, patch-latex-content.mjs) and then run
  // their real path — probing those would execute side effects (merges,
  // network). Require a conditional that actually reacts to the flag:
  // `includes('--help')` / `=== '--help'` / `'--help' in` style checks.
  if (!/['"]--help['"]\s*[)|\]]|(?:includes|has|startsWith)\(\s*['"]--help['"]|===\s*['"]--help['"]/.test(src)) return null;
  try {
    // spawnSync (not execFileSync) so we can read BOTH streams even on exit 0:
    // some scripts print usage to stderr and exit 0 (e.g. build-cv-html.mjs).
    const { status, stdout, stderr } = spawnSync('node', [scriptPath, '--help'], {
      encoding: 'utf-8', timeout: 10_000, cwd: JOBBER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (status !== 0) return null; // crashed or non-zero exit — cannot validate flags
    const out = stdout || stderr;
    const flags = [];
    for (const m of out.matchAll(FLAG_RE)) {
      const f = m[0];
      if (PLACEHOLDER_RE.test(f) || f === '--help') continue;
      flags.push(f);
    }
    return flags.length > 0 ? flags : ['--help'];
  } catch {
    // Script crashed on --help (or --help printed to stderr / exited 1) —
    // treat as "cannot validate flags", existence is still the hard gate.
    return null;
  }
}

/**
 * Read a script's --capabilities JSON contract, when it has one.
 *
 * Requires the source to reference '--capabilities' (cheap grep first — never
 * spawn a script that doesn't implement the flag), then spawns it once and
 * parses the JSON. Returns the flags array, or null when the contract is
 * absent or unparseable (caller falls back to --help).
 *
 * @param {string} scriptPath - Absolute path to the script.
 * @returns {string[]|null} Documented flags (including --help), or null.
 */
function capabilitiesFlags(scriptPath) {
  const src = readFileSync(scriptPath, 'utf-8');
  if (!src.includes('--capabilities')) return null;
  try {
    const { status, stdout } = spawnSync('node', [scriptPath, '--capabilities'], {
      encoding: 'utf-8', timeout: 10_000, cwd: JOBBER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (status !== 0) return null;
    const parsed = JSON.parse(stdout.trim());
    if (!parsed || !Array.isArray(parsed.flags)) return null;
    return parsed.flags.filter(f => f !== '--capabilities');
  } catch {
    return null; // malformed or crashed — fall back to --help
  }
}

/**
 * Validate all invocations. Returns { errors, warnings, infos }.
 *
 * @param {Array<{file: string, script: string, flags: string[]}>} invocations
 * @returns {{errors: Array<object>, warnings: Array<object>, infos: Array<object>}}
 */
export function validateInvocations(invocations) {
  const errors = [];
  const warnings = [];
  const infos = [];
  const helpCache = new Map();
  const repoRoot = resolve(JOBBER);

  // R-01: progress feedback. Probes run `--help` on each unique script, and
  // playwright-importing scripts can take ~10s each — a ~40s run with no
  // output looks hung in CI. Pre-count the unique scripts we'll probe and
  // emit a stderr heartbeat every few probes. Suppressed in --json mode so
  // parsers always get clean stdout AND stderr.
  const uniqueProbeScripts = new Set(
    invocations
      .filter(i => i.flags.length > 0)
      .map(i => i.script),
  );
  let probesDone = 0;
  const totalProbes = uniqueProbeScripts.size;

  for (const inv of invocations) {
    // Path-traversal guard (SE-01): the script name is regex-extracted from
    // mode .md content, so a crafted `node ../../evil.mjs` could resolve
    // outside the repo. Resolve and require the result to stay under the
    // repo root (plus a trailing sep so a sibling prefix like `JobberX` can't
    // pass the startsWith check).
    const scriptPath = resolve(JOBBER, inv.script);
    if (!scriptPath.startsWith(repoRoot + sep) || !existsSync(scriptPath)) {
      errors.push({
        file: inv.file,
        script: inv.script,
        message: `mode references node ${inv.script} which does not exist or escapes the repo root`,
      });
      continue;
    }
    if (inv.flags.length === 0) continue; // nothing more to check

    if (!helpCache.has(inv.script)) {
      probesDone++;
      if (!JSON_OUT && totalProbes > 0) {
        process.stderr.write(`\r🔍 Validating script flags: ${probesDone}/${totalProbes} (${inv.script})`);
      }
      helpCache.set(inv.script, helpFlags(inv.script));
    }
    const documented = helpCache.get(inv.script);
    if (documented === null) {
      infos.push({
        file: inv.file,
        script: inv.script,
        message: `node ${inv.script} has no --help handler — flag compatibility not checked`,
      });
      continue;
    }
    const undocumented = inv.flags.filter(f => !documented.includes(f));
    if (undocumented.length > 0) {
      warnings.push({
        file: inv.file,
        script: inv.script,
        flags: undocumented,
        message: `node ${inv.script} flags [${undocumented.join(', ')}] not in --help output [${documented.join(', ')}]`,
      });
    }
  }
  // Clear the progress line (if any was emitted).
  if (probesDone > 0 && !JSON_OUT) process.stderr.write('\n');
  return { errors, warnings, infos };
}

// ---- Main (only when invoked directly, not when imported by tests) ----
// `|| ''` guards the case where Node is invoked without a script arg (e.g. `node -e`).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const invocations = collectInvocations();
  const { errors, warnings, infos } = validateInvocations(invocations);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      filesScanned: new Set(invocations.map(i => i.file)).size,
      invocations: invocations.length,
      errors,
      warnings,
      infos,
    }, null, 2));
  } else {
    const filesScanned = new Set(invocations.map(i => i.file)).size;
    console.log(`📄 ${filesScanned} mode file(s), ${invocations.length} node invocations`);
    for (const e of errors) console.log(`❌ ${e.file}: ${e.message}`);
    for (const w of warnings) console.log(`⚠️  ${w.file}: ${w.message}`);
    for (const i of infos) console.log(`ℹ️  ${i.file}: ${i.message}`);
    if (errors.length === 0 && warnings.length === 0) {
      console.log('✅ All mode→script invocations resolve to existing scripts.');
    } else {
      console.log(`\n${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s)`);
    }
  }

  if (CI_MODE && errors.length > 0) process.exit(1);
  process.exit(0);
}
