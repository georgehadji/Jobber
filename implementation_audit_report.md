# Implementation Audit Report

**Subject:** ARCH-AUDIT-V2 remediation plan — full-plan status (Steps 1–6) as of current branch tip
**Plan:** `reflective-booping-sundae.md` (approved; local to this machine at `~/.claude/plans/`)
**Branch reviewed:** `chore/scan-data-source-cluster` @ `a1c267d`
**Baseline for this audit:** `ed0c1a6` (Steps 1–5 merged as PR #11, previously audited — see §0)
**Diff since baseline:** 55 files changed, +9,759 / −14,725 across PRs #13–#22 (all individually merged to `main`)
**Reviewer note:** this audit reviews work performed by the same agent that authored it. Findings are evidence-cited; a defect this agent introduced in the current branch tip is reported with the same weight as any other finding (§7, C-1).

---

## 0. Relationship to the prior audit

`implementation_audit_report.md` previously held a report dated 2026-08-28 reviewing commit `ed0c1a6` (PR #11, Steps 1–5 only). That report is superseded by this one — its three findings are re-verified below, not re-derived from scratch:

| Prior finding | Status now | Evidence |
|---|---|---|
| R-1 — dangling `tests/README.md` cross-reference ("process.exit guard below" pointed at nothing) | ✅ **Fixed** | [tests/README.md:57-70](tests/README.md:57) now contains the referenced "### The process.exit guard" section |
| R-2 — CI fully non-functional (0 steps executed, all checks failing) | ✅ **Resolved** | This session confirmed the outage was billing/capacity-side (cross-branch/cross-date evidence), then confirmed restoration: PR #22 shows 13/13 checks passing, including all three OS runners (`test (ubuntu-latest)`, `test (macos-latest)`, `test (windows-latest)`) |
| R-3 — `normalizeCompanyName` builds `RegExp` per call instead of at module load | ✅ **Fixed** | Commit `77549a4` precompiles both pattern lists to `LEGAL_SUFFIX_RES`/`GENERIC_DESCRIPTOR_RES` at module scope ([lib/company-name.mjs:26-27](lib/company-name.mjs:26)) — hand-verified behaviorally identical to the per-call version it replaced |

All three are closed. This audit's own new findings are in §7.

---

## 1. Executive Summary

**Plan compliance:** Steps 1–5 remain correctly implemented and now carry materially stronger verification than at the prior audit — that review had zero working CI; this one has full three-OS CI evidence. Step 6 (`test-all.mjs` decomposition), explicitly scoped by the plan as multi-session/staged work, has progressed substantially since: `test-all.mjs` is down from 12,585 lines (pre-plan) to **4,068 lines**, a 68% reduction, via 9 extraction commits across PRs #13–#22, each independently merged and CI-gated. Two of the plan's seven named clusters (interview/offer/legal-guardrail; part of batch/openrouter/eval) remain inline and un-extracted — expected, not a defect, per the plan's own "do not attempt this in one sitting" instruction.

**Out-of-plan work found bundled into PR #22:** a README rewrite (dropping 16 translated copies + upstream personal case-study content), a genuine macOS-only bug fix in `lib/llm-providers.mjs`'s CLI shim (caught by CI once it came back online), and two `.claude/` dev-tooling config files. None of these were in the plan. All are independently justifiable (see §2), but they are scope additions and are reported as such, not silently folded into "plan compliance."

**A new, currently-failing local check was found on the reviewed branch tip.** `node test-all.mjs --quick` at `a1c267d` reports **3344 passed, 1 failed, 1 warning** — the failure is real and reproducible, not flaky (see §7, C-1). It was introduced by this session's own `.claude/launch.json` commit, which was pushed to this branch *after* PR #22 had already merged — meaning it never ran through CI and is not on `main`. This is unrelated to the remediation plan but blocks treating the current branch tip as clean.

**One latent defect was found in Step 4's deliverable** (`lib/company-name.mjs`), pre-existing in the code before this plan touched it and carried over verbatim by the (correct, faithful) Step 4 move — not introduced by the plan. A verified fix package exists (see §7, C-2) but has not been applied.

**Verdict: APPROVED WITH CHANGES.** The plan's own work is sound. Two corrections are needed before the branch is push-clean: one mechanical (register or gitignore `.claude/launch.json`), one substantive but pre-existing (the company-name collision). Neither invalidates Steps 1–6's execution quality.

---

## 2. Plan Compliance Matrix

| Plan Item | Status | Evidence | Notes |
|---|---|---|---|
| **Step 1** — relocate 15 scratch files to `local/` | ✅ Complete | All 11 root files + 4 `batch/` files now under `local/` and `local/batch/`; `git log --diff-filter=D` on their old paths returns nothing (never tracked, so no commit needed — matches the plan's own reasoning) | Re-verified fresh this session, not assumed from the prior audit |
| **Step 2** — remove Apify `process.env` fallbacks | ✅ Complete | [plugins/apify/index.mjs:180](plugins/apify/index.mjs:180) reads only `ctx?.env?.APIFY_TOKEN`; `_apify.mjs`'s `hasToken(token)`/`runActor({token})` take no default | Re-read both files fresh this session; matches Gmail/Notion's fail-fast pattern exactly, as the plan required |
| **Step 3** — extract `classifyFetchError` → `lib/http-errors.mjs` | ✅ Complete | [lib/http-errors.mjs](lib/http-errors.mjs) (25 ln); wired into `verify-portals.mjs:35`, `scan.mjs:44` | Re-read and hand-traced this session; verbatim, no drift |
| **Step 4** — extract `normalizeCompanyName` → `lib/company-name.mjs` | ✅ Complete (move) / ⚠️ pre-existing bug found | [lib/company-name.mjs](lib/company-name.mjs); 4 importers updated (`scan.mjs:48`, `detect-reposts.mjs:29`, `invite-match.mjs:30`, `invite-match.test.mjs:10`) | The move is faithful. A latent collision defect in the moved logic was found this session — pre-dates Step 4, not caused by it. See §7 C-2 |
| **Step 5** — dedupe test discovery → `lib/test-discovery.mjs` | ✅ Complete | [lib/test-discovery.mjs](lib/test-discovery.mjs) (39 ln, since strengthened by `77549a4` — see below); both `test-all.mjs` and `test-runner.mjs` import `discoverTests`/`endsProcess` from it | Function was renamed `callsProcessExit` → `endsProcess` and extended to also catch bare `finish()` calls (commit `77549a4`) — a real bug fix (`tests/eval-runner.test.mjs` had been silently truncating the suite), executed *through* the new shared module exactly as Step 5 intended. Confirms the dedup was worth doing: the fix landed once, not twice. |
| **Step 6** — decompose `test-all.mjs` (7 clusters) | 🟡 In progress, plan-conformant | `test-all.mjs`: 12,585 → 4,068 lines; 9 extraction commits, each its own merged PR (#13–#22); `tests/` now holds 134 auto-discovered files | Execution diverged from the plan's suggested 7-cluster names — actual splits are finer-grained (e.g. `scan-archive-location-filter`, `cli-docs-skill-integrity`, `followup-tracker-lifecycle` don't map 1:1 to the plan's 7 items). This is judgment applied *within* the plan's stated intent ("each independently regression-gated"), not a deviation from it. **Remaining, confirmed still-inline:** the full interview/offer/legal-guardrail cluster (plan item 6 — sections 52, 55b, 61–70 in current `test-all.mjs`, its largest un-extracted block) and part of the batch/openrouter/eval cluster (plan item 5 — sections 44/44b–44e remain; only the batch/scan-rediscovery sub-topic was extracted) |
| **Verification** — baseline + both gates, every step | ✅ Complete, materially stronger than prior audit | This session: PR #22 CI — 13/13 checks green across ubuntu/macos/windows. Fresh local re-run at current HEAD: `test-runner.mjs --parallel 4` → 2837/0/1. `test-all.mjs --quick` → **3344/1/1 — one failure, see §7 C-1** | The prior audit had *no* working CI at all (billing outage) and Windows-only local runs. This audit has full cross-OS CI evidence for everything through PR #22's merge, though C-1 is on a commit CI never saw (see below) |

**Out-of-scope work found in PR #22** (not in the plan; assessed on its own merits, not against plan compliance):

| Item | Assessment |
|---|---|
| README rewrite, drop 16 translated copies (`2c82919`) | Justified independently — removes upstream's personal case-study/outcome claims that would misattribute to this fork; `update-system.mjs` `SYSTEM_PATHS` correctly pruned in the same commit |
| `updater-migration-tests.mjs` guard fix (`8e3af7f`) | Directly required by the README commit — the guard's own `requiredSystemPaths` list still named the 5 removed translations; fixing it is not scope creep, it's completing the prior commit correctly |
| `lib/llm-providers.mjs` macOS symlink fix (`1e21f50`) | Genuine, previously-latent, macOS-only bug (`realpath`d `import.meta.url` compared against a raw `argv[1]`, breaking under any `os.tmpdir()` fixture on macOS). Found only because CI came back online mid-session and exercised a real macOS runner — impossible to catch from this Windows dev environment. Correctly scoped to the one file with demonstrated breakage, not spectulatively to the ~20 other files sharing the same guard pattern |
| `.claude/launch.json`, `.claude/settings.json` (`a1c267d`) | Committed after PR #22 already merged; never CI-validated. `.claude/launch.json`'s local-check failure is now fixed — see §7 C-1 |

---

## 3. Architecture Compliance Assessment

**Verdict: compliant**, with one sourcing correction from the prior audit: the "`lib/` uses named exports only, never a default, never a class" rule is **not** written in `ARCHITECTURE.md` — grepped it directly this session, no match. It is the *plan's own* stated "paradigm baseline" (inferred from existing `lib/file-lock.mjs`, `lib/context-budget.mjs`), not an independently-documented architecture mandate. Citing it as if `ARCHITECTURE.md` requires it would overclaim the source; the underlying observation (all three new `lib/` modules follow it) still holds.

| Rule (and its actual source) | Assessment |
|---|---|
| `lib/` modules: named exports only, plain-arg pure functions, no `process.env` — *plan's paradigm baseline, not ARCHITECTURE.md* | ✅ All three new modules (`http-errors.mjs`, `company-name.mjs`, `test-discovery.mjs`) comply |
| CLI scripts depend on `lib/`, not on each other — *plan's own Step 3/4 rationale* | ✅ Eliminated both entry-point→entry-point imports the original audit flagged (`scan.mjs`→`verify-portals.mjs`, `scan.mjs`→`invite-match.mjs`) |
| No new dependencies | ✅ Repo remains at 4 production deps (unchanged since prior audit) |
| Plugin `ctx.env` port / `_engine.mjs buildCtx` adapter boundary — *observed convention, Gmail/Notion plugins* | ✅ Apify now conforms |
| No backwards-compat shims when call sites can be updated directly — *user's own global coding-style rule* | ✅ No re-exports left anywhere; re-verified across all Step 3–5 extractions this session |
| System vs. User layer — `DATA_CONTRACT.md` / `AGENTS.md` | ✅ Every file touched since `ed0c1a6` (`lib/`, `tests/`, `plugins/apify/`, `update-system.mjs`, `test-all.mjs`, `test-runner.mjs`, `README.md`, `.claude/*`) falls outside the documented User Layer path list (`cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `article-digest.md`, `portals.yml`, `data/*`, `reports/*`, `output/*`, `interview-prep/*`) |
| `update-system.mjs` `SYSTEM_PATHS`/`USER_PATHS` must classify every tracked file | ✅ **Fixed** — `.claude/launch.json` was untracked (`git rm --cached`) and added to `.gitignore` instead of being force-classified, matching how `.claude/settings.local.json` is already handled. No longer a tracked-but-unclassified file. See C-1 |

**Import-cycle note (carried forward, still holds):** `providers/_registry.mjs`'s documented reason for staying separate from `plugins/_registry.mjs` — avoiding a cycle "via `classifyFetchError`" — is *reduced*, not eliminated, by Step 3: `verify-portals.mjs` and `scan.mjs` both now depend downward on dependency-free `lib/http-errors.mjs` instead of laterally on each other for that one function. The two registries remain separately justified on their own terms (security/trust chain vs. plain dispatcher), independent of this.

---

## 4. Code Quality Findings

**DRY.** Confirmed net reduction, not just relocation: Step 5's dedup paid for itself concretely — the `endsProcess`/`finish()` fix (`77549a4`) landed once in `lib/test-discovery.mjs` and both runners inherited it, rather than needing the same fix applied twice (which is exactly the failure mode the original audit flagged `lib/file-lock.mjs`'s header as warning against).

**KISS/YAGNI.** Still holds under fresh review. No Strategy pattern, no factory, no interface-with-one-implementation across any of the 9 Step-6 extraction commits or the 3 `lib/` modules — each is a plain module of pure functions or a plain `tests/*.test.mjs` file.

**Error handling.** Apify's boundary is strictly better post-Step-2: fails fast with an actionable message instead of silently falling through to ambient env. No change to this assessment.

**Documentation.** `tests/README.md`'s dangling reference (prior R-1) is fixed and now accurate. One **new** documentation-vs-behavior mismatch found this session, in code the plan touched only by relocating it: `lib/company-name.mjs`'s docstring explicitly claims `"Data Solutions"` and `"Data Corp"` "don't collapse to the same 'data' key" — hand-traced execution shows they do (both reduce to `"data"`; `companySimilarity('data','data')` short-circuits to a perfect `1.0`). See §7 C-2 for the full causal chain and a verified fix.

**Improvement opportunity, not a defect (unchanged from prior audit, now closed):** the `RegExp`-per-call issue (prior R-3) is fixed.

---

## 5. Testing & Coverage Assessment

| Dimension | Assessment |
|---|---|
| Regression coverage | ✅ Strong across all of Steps 1–5's deliverables; each moved function retains its pre-existing test coverage through the new import paths |
| Step 6 test coverage | ✅ Every extracted cluster ships as its own `tests/*.test.mjs`, auto-discovered — no manual registration needed, matching the documented convention |
| Unit tests added for Steps 1–5 | ➖ None — appropriate, these are verbatim moves with pre-existing coverage |
| Acceptance criteria (plan's own bar: identical pass/fail counts before/after each step) | ✅ for Steps 1–5 (per prior audit, re-confirmed structurally sound this session); ✅ for each individual Step-6 PR (each merged independently, implying its own gate passed) |
| **CI/CD compatibility — material finding** | ⚠️ PR #22 itself: ✅ full 13/13 cross-OS green. **But the branch's current tip (`a1c267d`) was never submitted to CI** — it was pushed directly to a branch whose PR had already merged. `main` does not contain this commit. |
| Local full-suite gate at current tip | ✅ `test-all.mjs --quick`: **3345 passed, 0 failed, 1 warning**, re-run after the C-1 fix — baseline restored. `test-runner.mjs --parallel 4`: 2837 passed, 0 failed, 1 warning. |

**Both counts above were generated fresh in this session** (not carried over from before the merge), specifically to avoid citing stale numbers for this report.

---

## 6. Risk & Regression Analysis

| Risk | Severity | Assessment |
|---|---|---|
| Architectural regression (plan's own work) | None | Steps 1–5 reduce coupling; Step 6 progress reduces `test-all.mjs`'s monolith risk with no boundary weakened |
| Technical debt (plan's own work) | Net reduction | ~9,000+ net lines moved out of one file into topically-organized, independently-runnable test files |
| Backward compatibility | Low, unchanged from prior audit | Internal script internals only, no published API surface, project convention explicitly disallows compat shims |
| Security — Apify | Improved, unchanged from prior audit | Sandbox boundary enforced, not advisory |
| Security — new Step 6 test files | None | Test-only code, no network/secrets/eval/shell paths |
| **Data-matching correctness — `lib/company-name.mjs`** | **Medium (new)** | Two distinct companies sharing one leading word plus *either* a legal suffix (Inc/Corp/LLC) *or* any generic descriptor (Solutions/Technologies/Group/Holdings) normalize to an identical key, scoring a false `1.0` "exact match" in `invite-match.mjs`'s ranking. Bounded: both consumers (`invite-match.mjs`, `detect-reposts.mjs`) are advisory/reporting only — a human reviews the ranked output, nothing auto-writes. Pre-existing in the code before this plan; carried over verbatim, not introduced. Full fix package available, not yet applied — see C-2 |
| **Repo hygiene — `.claude/launch.json`** | **Resolved** | Hardcoded an absolute, machine-specific path (`E:/Documents/Vibe-Coding/Porphyra`) and was tracked-but-unclassified in `update-system.mjs`. Fixed by gitignoring it and `git rm --cached` (kept locally, untracked) — no contributor's clone ships it anymore. See C-1 |
| CI/branch-hygiene process risk | Low-Medium (new, process not code) | Pushing new commits to a branch after its PR has merged, with no new PR opened, means those commits get zero independent verification and don't reach `main`. Not a plan defect — a process gap surfaced by this session's own actions. Worth the user's attention going forward, not a code fix |
| Cross-platform (Steps 1–5) | Resolved | Prior audit's "untested on Linux/macOS" caveat is now closed — PR #22's CI ran and passed on all three OSes |

---

## 7. Required Corrections

| Severity | File | Issue | Recommendation |
|---|---|---|---|
| **FIXED** | `.gitignore` | **C-1.** `.claude/launch.json` was tracked, hardcoded an absolute machine-specific path (`E:/Documents/Vibe-Coding/Porphyra`), and was absent from both `SYSTEM_PATHS` and `USER_PATHS` — `node test-all.mjs --quick` failed on it (3344 passed, 1 failed). Confirmed reproducible, not flaky; confirmed `.claude/settings.json` was *not* affected (already registered at `update-system.mjs:402`). | Applied option (b) from the original two-option recommendation: added `.claude/launch.json` to `.gitignore` (matching `.claude/settings.local.json`'s existing treatment) and ran `git rm --cached .claude/launch.json` — file kept locally, untracked, no `update-system.mjs` classification needed. Re-ran `test-all.mjs --quick` post-fix: **3345 passed, 0 failed, 1 warning** — baseline restored. Still pending: commit this fix and open it through an actual PR + CI rather than a direct push, per C-3. |
| **MEDIUM — pre-existing, not introduced by this plan** | `lib/company-name.mjs` (docstring + `normalizeCompanyName`, lines ~38-41 and ~67-72) | **C-2.** `"Data Corp"` and `"Data Solutions"` both normalize to `"data"` — a legal suffix and a generic descriptor can each independently collapse a name to the same bare leading token, contradicting the function's own docstring, which cites this *exact pair* as a case it prevents. Hand-verified via full execution trace, not assumed. Reachable from `invite-match.mjs`'s ranking (`companySimilarity('data','data')` → false `1.0`) and `detect-reposts.mjs`'s clustering. Bounded severity: both call sites are advisory/reporting, never auto-write. | A verified, minimal fix package was produced and reviewed earlier this session: track whether a legal suffix was stripped from the name; only allow a generic-descriptor strip to collapse the name to a single remaining token when one was. Hand-verified against all 6 existing `invite-match.mjs`/`invite-match.test.mjs` assertions — none regress. Diff, regression test, and full adversarial self-review already exist in this session's transcript; not re-pasted here to keep this report focused on plan compliance. **Not yet applied** — apply on request. |
| **INFO** | Branch/PR process | **C-3.** `a1c267d` was pushed to `chore/scan-data-source-cluster` after PR #22 (which drew from that same branch) had already squash-merged. The commit reached `origin` but not `main`, and was never submitted to CI. | Open a fresh PR for any further work on this branch (or a new branch), so it gets independent CI verification before merging — same standard the plan's own Step 6 PRs (#13–#22) were correctly held to. |
| **INFO — carried forward, now closed** | `tests/README.md`, `lib/company-name.mjs` (regex precompilation) | Prior audit's R-1 and R-3. | No action — both confirmed fixed this session (§0). |

No CRITICAL findings. No findings block Steps 1–6's own execution quality — C-1 (fixed this session) and C-2 (open) are scoped to work bundled into PR #22 alongside the plan or pre-dating the plan entirely, respectively.

---

## 8. Final Verdict

# APPROVED WITH CHANGES

The plan itself — Steps 1 through 6 — is implemented faithfully, at high fidelity, and (as of this session) with materially stronger verification than before: full three-OS CI evidence where the prior audit had none. Step 6's partial state is exactly what the plan called for ("do not attempt this in one sitting"), not a shortfall.

**One correction remains, and it does not reflect on the plan's execution:**

1. **C-1 is fixed.** The branch tip's local-gate failure (`.claude/launch.json` untracked-in-manifest gap) is resolved — `test-all.mjs --quick` is back to 3345/0/1. The underlying commit (`a1c267d`) plus this fix still need to go through an actual PR + CI rather than a direct push (C-3), not yet done.
2. **C-2 is real but not urgent.** A latent, pre-existing data-matching defect in Step 4's moved code, with bounded (advisory-only) impact and a verified fix ready to apply on request.

Everything already merged to `main` through PR #22 (`e11367e`) is sound. C-1's fix is applied locally but, like `a1c267d` itself, has not yet gone through a PR.

---

*Report generated 2026-08-29, C-1 fix applied and re-verified 2026-08-30. Evidence: `git log`/`git diff --stat` across `ed0c1a6..HEAD`, `gh pr list --state merged` (PRs #11, #13–#22), `gh pr checks 22`, local runs of `node test-all.mjs --quick` (3344/1/1 pre-fix, 3345/0/1 post-fix) and `node test-runner.mjs --parallel 4` (2837/0/1) at current HEAD, direct reads of `lib/http-errors.mjs`, `lib/company-name.mjs`, `lib/test-discovery.mjs`, `plugins/apify/index.mjs`, `plugins/apify/_apify.mjs`, `update-system.mjs`, `tests/README.md`, `ARCHITECTURE.md`, `.claude/launch.json`, `.gitignore`.*
