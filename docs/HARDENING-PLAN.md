# Hardening Plan

Implementation plan for type enforcement, contract testing, dead-code detection, and style floor in career-ops — derived from a comparative review against [JobOps](https://github.com/DaKheera47/job-ops).

**Status:** proposal. Nothing here is implemented yet.

---

## Guiding constraints

Every item below is designed against the architecture in [ARCHITECTURE.md](../ARCHITECTURE.md) and [DATA_CONTRACT.md](../DATA_CONTRACT.md). The plan does not get to relax these:

| Constraint | Consequence for this plan |
|---|---|
| **No build step** — pure ESM `.mjs`, run directly by `node` | Type checking must be *analysis-only* (`--noEmit`). No transpile, no `dist/`, no source rewrite. TypeScript syntax is off the table; JSDoc is the vehicle. |
| **Flat root is deliberate** ([#1386](https://github.com/santifer/career-ops/issues/1386)) | New tooling adds config files at root, not directory reorganization. |
| **Every tracked file must be in `SYSTEM_PATHS` or `USER_PATHS`** | Each new file below names its registration explicitly. `validate-system-paths-coverage.mjs` fails CI otherwise. |
| **Files are canonical, DBs derived** | Untouched. Nothing here introduces a store. |
| **The brain is Markdown** | No scoring logic moves into code. |
| **Local-first, zero-keys** | No new runtime dependency. Everything added is a `devDependency` or zero-dep. |
| **`--self-test` convention** | New validators embed their own self-tests behind `--self-test`, matching `validate-system-paths-coverage.mjs`, `analyze-patterns.mjs`, et al. |

**Paradigm note.** career-ops is not object-oriented and should not become so. It is *module-oriented functional*: pure functions over plain data, side effects pushed to the edges (`fs`, `fetch`), dependency injection by parameter (the `ctx` object handed to `provider.fetch`). Every pattern named below is chosen to fit that grain — no classes, no inheritance, no DI container.

---

## The core finding

**90 files already carry `// @ts-check`. 77 files carry JSDoc `@typedef`/`@type` annotations. There is no `tsconfig.json` and no CI step.**

Those annotations fire in an editor and nowhere else. The contract in `providers/_types.js` is well-designed and completely unenforced — nothing stops a provider from drifting off it, and nothing catches a typo'd property access in `tracker-parse.mjs` that every one of its callers inherits.

This is not a "add types" project. The types exist. This is a **wire up the enforcement that was always intended** project. That reframing is what makes it cheap.

---

## Phase 1 — Type enforcement (highest value, smallest diff)

### 1.1 Add `tsconfig.json`

Root-level, analysis-only. The critical setting is `checkJs: false`: it means **only files that opt in with `// @ts-check` are checked**, exactly matching the idiom already in the codebase. This yields a green baseline on day one rather than 4,000 errors nobody will triage.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,        // per-file opt-in via `// @ts-check` — do NOT flip to true
    "noEmit": true,
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": false,
    "noImplicitAny": false,
    "types": ["node"]
  },
  "include": [
    "*.mjs",
    "providers/**/*.mjs",
    "providers/**/*.js",
    "plugins/**/*.mjs",
    "plugins/**/*.js",
    "lib/**/*.mjs",
    "utils/**/*.mjs"
  ],
  "exclude": ["node_modules", "web", "dashboard", "batch", "output", "test-fixtures"]
}
```

`web/` is excluded to preserve the isolation contract already encoded in `validate-system-paths-coverage.mjs` (`EXCLUDE_PREFIXES = ['web/']`).

**Registration:** add `'tsconfig.json'` to `SYSTEM_PATHS` in `update-system.mjs`.

### 1.2 Add the devDependency

```bash
npm i -D typescript@~5.9 @types/node
```

`typescript` is a devDependency only. It never ships to users at runtime, and `npm install --ignore-scripts` in CI already skips the Playwright download, so CI cost is one small package.

### 1.3 Add the npm script

```jsonc
// package.json → scripts
"check:types": "tsc --noEmit"
```

### 1.4 Wire into `test-all.mjs`

Insert as a new section between the existing §1 (syntax) and §2 (script execution) — type errors are a superset of syntax errors and should fail before the slower execution section.

```js
// ── 1b. TYPE CHECKS ─────────────────────────────────────────────
// Only files carrying `// @ts-check` are analyzed (tsconfig sets
// checkJs:false). This enforces the annotations that 90 files already
// declare but that nothing verified before.

console.log('\n1b. Type checks (@ts-check opt-in files)');

if (existsSync(join(ROOT, 'node_modules', 'typescript'))) {
  const tscResult = run(NPX, ['tsc', '--noEmit'], { cwd: ROOT });
  if (tscResult !== null) pass('tsc --noEmit clean');
  else fail('tsc --noEmit reported type errors');
} else {
  // Never hard-fail a contributor who ran `npm install --omit=dev`.
  console.log('   ⊘ typescript not installed — skipped');
}
```

The graceful skip matters: the repo's own guidance is that scripts "handle missing files gracefully". A contributor without devDeps must still get a green suite.

**CI:** already covered — `.github/workflows/test.yml` runs `npm install --ignore-scripts` (which installs devDeps) then `node test-all.mjs --quick`. No workflow edit needed.

### 1.5 The ratchet — `validate-typecheck-coverage.mjs`

This is the piece that makes Phase 1 durable rather than a one-off. Without it, `@ts-check` coverage silently erodes as new files land without the pragma.

**Pattern: monotonic quality gate (ratchet).** A committed floor value that may only ever increase. Directly mirrors the existing `validate-system-paths-coverage.mjs` in both structure and spirit.

```js
#!/usr/bin/env node
/**
 * validate-typecheck-coverage.mjs — ratchet guard for @ts-check adoption.
 *
 * Counts tracked .mjs/.js files carrying `// @ts-check` and fails if the
 * count drops below the committed floor in .typecheck-floor. New files
 * may land unchecked; the total may never regress.
 *
 * Raise the floor: node validate-typecheck-coverage.mjs --bless
 * Run:            node validate-typecheck-coverage.mjs
 * Self-test:      node validate-typecheck-coverage.mjs --self-test
 */
```

Behaviour:

| Invocation | Effect |
|---|---|
| (bare) | Count vs. floor. Exit 1 if `count < floor`. |
| `--bless` | Rewrite `.typecheck-floor` to the current count. Run after adding pragmas. |
| `--self-test` | Assert the counting logic against fixtures. Wired into `test-all.mjs` §2. |

Floor file `.typecheck-floor` contains a single integer (`90` at time of writing).

**Registration:** add `'validate-typecheck-coverage.mjs'` and `'.typecheck-floor'` to `SYSTEM_PATHS`.
**Wire:** add `{ name: 'validate-typecheck-coverage.mjs --self-test', expectExit: 0 }` to the `scripts` array in `test-all.mjs` §2, and the bare run to §5 alongside the existing `validate-system-paths-coverage.mjs` bare run (§5 executes from the real tree, which `git ls-files` requires).

### 1.6 Incremental expansion order

Add `// @ts-check` to unchecked files in dependency order — shared modules first, so their inferred types flow outward to callers:

1. `tracker-parse.mjs`, `tracker-utils.mjs`, `tracker-links.mjs` — every tracker script imports these; a wrong shape here is a bug in a dozen callers.
2. `liveness-core.mjs`, `fingerprint-core.mjs`, `pipeline-lock.mjs` — shared cores.
3. `merge-tracker.mjs`, `set-status.mjs`, `dedup-tracker.mjs`, `normalize-statuses.mjs` — the tracker write path, where a silent shape bug corrupts canonical user data.
4. Everything else, opportunistically, whenever a file is touched for another reason.

Run `--bless` after each batch. One PR per group keeps review tractable.

**Expected yield.** The highest-probability catches are in group 1 and 3: property typos on tracker row objects, `undefined` reaching a `.trim()`, and arity drift between a helper and its callers — precisely the class the 500-check suite cannot see, because it only exercises the paths it already knows.

---

## Phase 2 — Provider contract test (highest value per line)

### The gap

`providers/_types.js` defines the `Provider` contract. Its own header says the runtime contract "is enforced by scan.mjs (id presence, fetch is a function, fetch returns an array)" — meaning enforcement happens *at scan time, per provider, only for providers a given user actually invokes*. A malformed provider ships green and breaks in the field for whoever enables that board.

76 providers. New providers are the project's most-wanted contribution and its highest-volume PR type.

### The fix

**Pattern: contract test (a.k.a. conformance suite).** One test that loads every implementation through the existing registry and asserts the shared interface — the substitutability check the Strategy pattern implies but cannot enforce in plain JS. Written once, it covers all 76 providers *and every provider added afterward, forever, with zero per-provider work.*

New file: `tests/providers/_contract.test.mjs` (auto-discovered by `test-all.mjs`; `tests/` is already a `SYSTEM_PATHS` prefix, so **no registration needed**).

Assertions per provider:

| # | Assertion | Rationale |
|---|---|---|
| 1 | Module has a default export | The contract's stated shape. |
| 2 | `id` is a non-empty string | Required by `_registry.mjs`. |
| 3 | `id` is globally unique across loaded providers | Collisions silently shadow a board today. |
| 4 | `id` matches its filename (minus `.mjs`) | Convention every current provider follows; makes `provider:` in `portals.yml` predictable. |
| 5 | `fetch` is a function | Required. |
| 6 | `fetch.length >= 1` | Must accept `(entry, ctx)`. Catches a signature typo'd to zero-arg. |
| 7 | `detect`, when present, is a function | Optional-but-typed field. |
| 8 | `detect(entry)` returns `null` or `{ url: string }` — probed with a synthetic entry | The routing contract: `null` means "not mine". |
| 9 | No unexpected top-level keys on the default export | Catches `fetchJobs:` where `fetch:` was meant — currently a silent no-op board. |
| 10 | File does not begin with `_` | `_`-prefixed files are helpers and must not be registered. |

Assertions 8–9 are where the real defects hide; 1–7 are cheap insurance.

**Explicitly out of scope:** no network. The contract test asserts *shape*, never *behaviour*. Live-endpoint probing is `verify-portals.mjs`'s job and must stay separate — a contract suite that hits the network becomes a flaky suite nobody trusts.

**Fixture strategy.** `detect()` is probed with a frozen synthetic `PortalEntry` (`{ name: 'contract-probe', careers_url: 'https://example.invalid/careers' }`). `.invalid` is reserved by RFC 2606 and can never resolve, so a provider that ignores the contract and tries to fetch inside `detect()` fails loudly instead of silently reaching the network.

### 2.1 Extend the provider README

Document the conformance suite in `providers/README.md` under "Module contract", with the one-line local command:

```bash
node test-all.mjs --only providers/_contract
```

That is the entire onboarding change needed for new-provider contributors.

---

## Phase 3 — Dead code and unused dependencies

### 3.1 `knip`

At ~70 root scripts with high drive-by PR volume, dead exports accumulate invisibly, and the flat-root doctrine means nothing structural surfaces them.

```bash
npm i -D knip
```

```jsonc
// knip.json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "entry": [
    "*.mjs",
    "providers/*.mjs",
    "plugins/**/index.mjs",
    "tests/**/*.test.mjs"
  ],
  "project": ["**/*.mjs", "**/*.js"],
  "ignore": ["web/**", "dashboard/**", "batch/**", "output/**", "test-fixtures/**", "scaffolder/**"],
  "ignoreDependencies": ["playwright"],
  "ignoreExportsUsedInFile": true
}
```

`playwright` is ignored because it is invoked as a CLI by `generate-pdf.mjs` via subprocess, not imported — knip cannot see that edge and would report it unused.

**Why a dependency here and nowhere else.** The plan's default is zero-dep, in-house validators matching existing patterns. Dead-code detection is the one place that loses: doing it correctly requires a full ESM import graph with re-export and dynamic-import resolution. That is not 80 lines, and a naive grep-based version produces false positives that train contributors to ignore it. Reuse beats rewrite.

**Registration:** `'knip.json'` → `SYSTEM_PATHS`.
**Wire:** advisory only at first — `npm run knip` as a documented command, **not** a CI gate. Promote to a gate only after one clean pass, so the first run's backlog does not block unrelated PRs.

### 3.2 Report-only CI comment (optional)

A `knip --reporter markdown` step posting to the PR, non-blocking. Fits the existing bot-assisted review culture (CodeRabbit, ledger-bot) without adding a hard gate.

---

## Phase 4 — Style floor

### The tension

`CLAUDE.md` currently states: *"No linter/formatter is configured — match surrounding style by hand."* That is workable at 5 files and unworkable at 70 with first-time contributors, and it converts style into reviewer labour on every PR.

### The constraint

A blanket `biome format --write` across 70 files would produce a five-figure-line diff, destroy `git blame` across the entire codebase, and collide with every open PR. That cost is not acceptable and the naive version of this suggestion should be rejected.

### The staged approach

**Stage 1 — lint only, no formatting.** Rules limited to correctness classes that are real bugs, not taste:

```jsonc
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": { "includes": ["**/*.mjs", "**/*.js", "!web/**", "!dashboard/**", "!node_modules/**", "!test-fixtures/**"] },
  "formatter": { "enabled": false },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": false,
      "correctness": {
        "noUnusedVariables": "warn",
        "noUnreachable": "error",
        "noConstantCondition": "error",
        "noSelfAssign": "error"
      },
      "suspicious": {
        "noDoubleEquals": "warn",
        "noDuplicateObjectKeys": "error",
        "noAsyncPromiseExecutor": "error",
        "noFallthroughSwitchClause": "error"
      }
    }
  }
}
```

`noDuplicateObjectKeys` and `noFallthroughSwitchClause` alone justify the install — both are silent-wrong-behaviour bugs that no test in the suite would catch.

**Stage 2 — formatting, only if the project wants it,** and then only as a single dedicated commit added to `.git-blame-ignore-revs` so `git blame` stays usable. This is a separate decision and this plan does not assume it.

**Registration:** `'biome.json'` → `SYSTEM_PATHS`.

---

## Phase 5 — Dependency integrity

Three concrete items, independent of everything above.

### 5.1 Pin exact versions

`playwright` is correctly pinned exact (`1.62.0`). The other three float on `^`:

```jsonc
"@google/generative-ai": "0.24.1",
"dotenv": "17.0.0",
"js-yaml": "4.1.1"
```

For a local-first tool that reads the user's CV and drives a browser, a floating minor is an unreviewed code change on every fresh install. `dependency-review.yml` and `sbom.yml` already run in CI — pinning closes the remaining gap without new infrastructure.

### 5.2 Reconsider the gitignored lockfile

`package-lock.json` is currently gitignored (`.gitignore:107`) with `!web/package-lock.json` excepted. Committing the root lockfile would pin the full transitive graph and make CI reproducible. This is a deliberate existing choice, so it is raised as a question rather than a recommendation — if the rationale is npm-package hygiene, `.npmignore` already handles that independently of git.

### 5.3 Document the `--ignore-scripts` path

`postinstall` downloads ~170 MB of Chromium. Contributors running only the test suite never need it. Add to `CONTRIBUTING.md`:

```bash
npm install --ignore-scripts   # skip the Chromium download; PDF/liveness tests will skip
```

CI already does exactly this.

---

## Phase 6 — Location intelligence (plugin, sketch only)

JobOps carries ~29 KB of location-domain logic plus dedicated visa-sponsorship providers. career-ops has substring `location_filter` matching in `portals.yml`.

For a tool shipping six market-specific mode sets, *"is this role actually reachable from where I live, and will they sponsor?"* is a real scoring input currently unmodelled.

**This belongs in the plugin layer, not core** — by the project's own parallel-feature test in `CONTRIBUTING.md`: it is adjacent to the core path, carries a large maintenance surface (jurisdiction data goes stale), and has no demonstrated multi-user demand yet.

Sketch, if pursued:

- A plugin exposing a pure `scoreLocation(job, profile) → { reachable, confidence, flags[] }`.
- Jurisdiction tables as `templates/*.yml` with `as_of` / `next_effective` fields — which `check-table-freshness.mjs` **already validates today**. The staleness infrastructure exists; only the data and scorer are missing.
- Feeds Block A of `modes/oferta.md` as an input, never as an override. The brain stays Markdown.

---

## Sequencing and cost

| Phase | Effort | Risk | Blocking? | Recommended order |
|---|---|---|---|---|
| 1. Type enforcement | ~half day setup + incremental | Very low — opt-in, green from day one | No | **1st** |
| 2. Provider contract test | ~half day | Very low — pure additive test | No | **2nd** (or 1st; independent) |
| 5. Dependency integrity | ~1 hour | Very low | No | **3rd** — trivial, do it alongside |
| 3. Dead code (knip) | ~2 hours + triage backlog | Low — advisory first | No | 4th |
| 4. Style floor (lint only) | ~2 hours + triage | Medium — needs maintainer buy-in on the no-format constraint | No | 5th |
| 6. Location intelligence | Weeks | High maintenance | Yes — needs an issue first | Not scheduled |

Phases 1, 2, and 5 are independent of each other and of everything else. Any can ship alone.

**Per `CONTRIBUTING.md`, Phases 3, 4, and 6 warrant an issue before code** — they are architecture/tooling changes, not bug fixes. Phases 1, 2, and 5 are closer to fixes (enforcing an existing contract, pinning existing deps) but Phase 1 adds a devDependency, so an issue is the safer route there too.

---

## What this plan deliberately does not do

- **No TypeScript migration.** JSDoc + `checkJs` gets ~90% of the safety at ~2% of the churn, and preserves the no-build-step property that lets a user `node scan.mjs` on a fresh clone.
- **No directory reorganization.** The flat root is load-bearing for the updater allowlist, plugins, and docs.
- **No test framework.** The `--self-test` convention and `tests/**/*.test.mjs` auto-discovery already work; adding vitest would be a parallel system with no gain.
- **No scoring logic moved into code.** `modes/*.md` stays the brain.
- **No mass reformat.** See Phase 4's constraint.
- **No new runtime dependency.** Everything added is `devDependencies`.
- **No scraping providers.** Out of bounds per `CONTRIBUTING.md`, and the ATS-API approach is more robust regardless.

---

## Appendix — `SYSTEM_PATHS` additions

Every new tracked file, for one consolidated edit to `update-system.mjs`:

```js
'tsconfig.json',
'validate-typecheck-coverage.mjs',
'.typecheck-floor',
'knip.json',        // Phase 3
'biome.json',       // Phase 4
```

`tests/providers/_contract.test.mjs` needs no entry — `tests/` is already a covered prefix (`update-system.mjs:181`).

Verify after editing:

```bash
node validate-system-paths-coverage.mjs
```
