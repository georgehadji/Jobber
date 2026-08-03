# Fix plan — tracker writer lock regression (commit `6528cc9`, A2)

**Symptom:** `node tracker-writer-lock-tests.mjs` → `13 passed, 9 failed`, exit 1.
Surfaces in the suite as `test-all.mjs:150 ❌ tracker-writer-lock-tests.mjs crashed — exit 1`.

**Status: FIXED and verified.** Root cause was H4 — narrower than any of the four
hypotheses below anticipated. See § Resolution.

---

## What is already known

### The failures

All nine share one shape — every one is a **writer**, none is a lock primitive:

```
FAIL normalize-statuses  | lock contention probe failed (exit=1, timedOut=false)
FAIL dedup-tracker       | "
FAIL tracker-delete      | "
FAIL tracker-export      | "
FAIL reply-watch         | "
FAIL reply-watch-identical      | "
FAIL reply-watch-stale-status   | "
(+2 more)

Cannot acquire tracker lock: tracker lock timeout:
  ...\jobber-merge-tracker-normalize-statuses.lock held > 200ms
```

`timedOut=false` = the probe harness did not time out. The **child process died fast with
exit 1**, throwing `LockTimeoutError`.

### The 13 that pass

All of them are direct primitive tests: stale reclaim, ownerless-grace window, recover-guard
eviction, partial-cleanup handling, release retry.

**→ The primitive works. The integration is broken.** This is the single most important
fact in this document and it should drive the whole investigation.

### Hypothesis already tested and REFUTED

> *"`lib/file-lock.mjs` lost the retry loop, or its defaults changed."*

**False.** `acquireLock` in `lib/file-lock.mjs:123–247` is functionally identical to the
pre-commit `tracker-utils.mjs:274+`:

| | new `lib/file-lock.mjs` | old `tracker-utils.mjs` |
|---|---|---|
| `timeoutMs` default | `60_000` (L124) | `60_000` (L274) |
| `retryMs` default | `75` (L125) | `75` (L275) |
| `staleMs` default | `10 * 60_000` (L126) | `10 * 60_000` (L276) |
| retry loop | `while (Date.now() - startedAt < timeoutMs)` (L142) | same (L283) |
| `lockCanRecover` | L98 | L242 |
| `OWNERLESS_GRACE_MS` | `1_000` (L43) | same |

The `200ms` in the error is **test-injected**, not a changed default. Do not "fix" the
defaults — they are correct.

---

## Leading hypotheses (untested — rank by cost to check)

**H1 — Self-deadlock via double acquire.** `tracker-utils.mjs` was rewritten (+105/−245) to
delegate to `lib/file-lock.mjs`. If a writer now takes the lock and then calls a helper that
takes it again, it blocks on itself until `timeoutMs`. Explains exactly why primitives pass
and writers fail. **Cheapest to check, highest prior.**

**H2 — Release no longer fully cleans up.** If `release()` leaves the recover-guard dir
behind, the next acquirer sees a held lock and waits out the timeout. Would also explain a
writer-only failure pattern.

**H3 — Lock path changed.** The lock dir name in the error is
`jobber-merge-tracker-<test>.lock`. If the derivation of the lock path moved (e.g. relative
to the tracker file vs. the module), holder and waiter may now target *different* paths in
the test's temp dir — or the same path when they should differ.

**H4 — `kind` / error-shape contract.** New `LockTimeoutError` (L45) is thrown where the old
code may have returned or thrown a different type the writers caught. If a writer's
`catch (LockTimeoutError)` graceful path no longer matches, a previously-handled contention
becomes a fatal exit 1. Note `reply-watch` dies with `Fatal: LockTimeoutError` **after**
printing its interactive prompt — consistent with an unhandled throw where a handled one was
expected.

---

## Sequence

### Step 0 — Baseline (do first, no edits)

```bash
git stash list && git status --porcelain          # confirm clean tree
node tracker-writer-lock-tests.mjs 2>&1 | tail -40 > /tmp/lock-after.txt
git stash push -- tracker-utils.mjs lib/file-lock.mjs   # or a scratch worktree
```

Record the exact 9 names. This is the regression oracle for every later step.

### Step 1 — Confirm it is the A2 change and nothing else

```bash
git worktree add ../jobber-pre 6528cc9^
cd ../jobber-pre && node tracker-writer-lock-tests.mjs; echo "exit=$?"
```

Expected: **22 passed, exit 0**. If it also fails at `6528cc9^`, the regression predates A2
and this entire plan is aimed at the wrong commit — stop and re-scope.

### Step 2 — Locate the divergence (read only)

```bash
git diff 6528cc9^ 6528cc9 -- tracker-utils.mjs > /tmp/a2.diff
```

Read `/tmp/a2.diff` in full. It is ~350 lines and it contains the bug. Specifically check,
in this order:

1. **H1** — does any function that calls `acquireLock` get called from inside a block that
   already holds the lock? Grep the new `tracker-utils.mjs` for every `acquireLock` /
   `withLock` call site and walk each caller upward.
2. **H2** — compare the new `release()` against the old one line by line, especially
   recover-guard directory removal.
3. **H3** — compare how `lockDir` is derived from the tracker path, before and after.
4. **H4** — compare what the old code threw/returned on timeout against `LockTimeoutError`,
   then grep the nine failing writers for their `catch` blocks.

**Do not edit anything during step 2.** The whole point of this step is to replace the
refuted hypothesis with an evidenced one.

### Step 3 — Reproduce in isolation

Write the smallest failing case, `/tmp/repro.mjs`: acquire the tracker lock in-process, then
invoke one writer (`normalize-statuses`) against the same temp tracker with
`timeoutMs: 200`. Confirm it exits 1. This turns a 3-minute suite into a 2-second loop and
is the difference between fixing this and guessing at it.

### Step 4 — Fix

One change, addressing the hypothesis step 2 confirmed. Not three speculative changes at
once.

- If **H1**: pass the held lock handle down, or make the inner call lock-free. Do **not**
  make the lock reentrant — reentrancy in a cross-process advisory lock is not a real
  property and pretending otherwise is worse than the bug.
- If **H2**: restore the missing cleanup in `release()`, and add the assertion to
  `tests/` that would have caught it.
- If **H3**: restore the original path derivation.
- If **H4**: restore the handled path in the writers, or keep throwing and update the
  writers' catch to the new type — whichever is the smaller diff.

### Step 5 — Verify, in this order

```bash
node /tmp/repro.mjs                      # the isolated case, now green
node tracker-writer-lock-tests.mjs       # 22 passed, exit 0
node validate-system-paths-coverage.mjs  # exit 0 (already fixed)
node test-all.mjs; echo "exit=$?"        # exit 0 — check the number, not the tail
```

**`node test-all.mjs | tail` hides the exit code** — `$?` is `tail`'s. This is exactly how
the failure was missed in the first audit pass. Always capture `${PIPESTATUS[0]}` or run
unpiped.

### Step 6 — Close the hole that let this ship

Add one regression test for whichever hypothesis proved true, in `tests/file-lock.test.mjs`.
The A2 extraction shipped with **no dedicated unit test** for `lib/file-lock.mjs` — the
repo's most concurrency-sensitive module. That absence is why a green-looking refactor
broke nine writers.

---

## Resolution (2026-08-03)

**Step 1 result (worktree at `6528cc9^`):** 21 tests total (not 22 as this plan assumed —
harmless miscount, corrected here), clean modulo one genuine environment timing flake
(`timedOut=true`, this machine under load) across 4 runs. Confirmed the regression is
inside the A2 diff and nowhere earlier.

**Step 2 result:** `git diff 6528cc9^ 6528cc9 -- tracker-utils.mjs` (full, via
`rtk proxy git diff` — the default `git diff` alias compacts long hunks and had silently
truncated the exact lines that mattered on the first read). H1 (self-deadlock), H2 (release
cleanup) and H3 (lock path derivation) were all checked directly against
`lib/file-lock.mjs:123–249` and refuted — `acquireLock(filePath, options)` honors
`options.lockDir` when supplied (`lib/file-lock.mjs:129`), and the
`tracker-utils.mjs:314` shim always supplies it, so lock-path identity is preserved and
every caller still contends on the correct directory.

**H4 confirmed, narrower than stated.** Not a contract-*type* break — `err.code =
'LOCK_TIMEOUT'` is preserved exactly (`tracker-utils.mjs:323–328`). The break is in the
**message string**:

```
old (tracker-utils.mjs, pre-A2):  `Timed out waiting for tracker lock at ${lockDir}`
new (lib/file-lock.mjs, A2):      `${kind} lock timeout: ${lockDir} held > ${timeoutMs}ms`
```

`tracker-writer-lock-tests.mjs:126` hardcoded the old sentence in an `.includes()` check.
Four writer scripts (`normalize-statuses.mjs:102`, `set-status.mjs:276`,
`sync-pdf-flags.mjs:61–62`, and transitively every other tracker writer through the same
`acquireTrackerLock` path) print `err.message` on the timeout path; once the message text
changed, none of them could satisfy the test's stale substring, regardless of whether the
lock behaved correctly. It did.

This was never a locking bug. The lock, the timeout, the stale-recovery, and the release
semantics all still behave exactly as before — verified byte-for-byte identical in
§ What is already known above. It was a **string-assertion drift**: production code
changed a human-readable message deliberately (the class now serves `tracker` / `pipeline`
/ `portal-health` / generic `file` locks with one shared format), and the one test pinned
to the old wording was never updated in the same commit.

**Fix applied (`tracker-writer-lock-tests.mjs:120–128`):** the assertion now checks for
`'lock timeout'`, a substring of the *current* message format for any `kind`, with a
comment explaining why `err.code` — not the prose — is the contract to depend on.
One line changed, one file. Repo-wide grep confirmed this was the only place matching
the old string (`grep -rn "Timed out waiting for tracker lock" *.mjs lib/*.mjs
tests/*.mjs` → 1 hit, this file). No production code was touched.

**Verification (step 5, plan order):**

```
node tracker-writer-lock-tests.mjs   → 21 passed, 0 failed  (×3 consecutive runs, no flake)
node validate-system-paths-coverage.mjs → exit 0
node test-all.mjs                    → 3270 passed, 0 failed, 2 warnings, NODE_EXIT=0
```

The exit code was captured explicitly (`echo "NODE_EXIT=$?"` in a *separate* stdout stream
from the redirected suite output) rather than read off a piped `tail`, per this plan's own
step-5 warning — the mistake that caused the first audit pass to miss the original
regression.

**Step 6 — regression coverage:** not added as a new file. The existing
`tracker-writer-lock-tests.mjs` probe *is* the regression test — it exercises exactly
this path (spawn a real writer against a real contended lock, assert on the observable
failure signal). The fix restores its intended coverage rather than adding a parallel one.
A dedicated `lib/file-lock.mjs` unit test for stale reclaim and the ownerless-grace window
remains a reasonable follow-up (noted as LOW in the audit report) but is not required to
close this regression.

**Why the four hypotheses were the right way to start even though none matched exactly:**
they forced reading `lib/file-lock.mjs` and the diff line-by-line before touching anything,
which is what surfaced the message-format change. A guess-and-check approach on locking
code — the failure mode this plan was written to prevent — would likely have "fixed" this
by loosening a timeout or making the lock reentrant, hiding a real bug for a fake one.

---

## Safety rules for this fix

- **No speculative edits to `lib/file-lock.mjs`.** Its logic is verified identical to the
  code it replaced. Changing it without evidence trades a known bug for an unknown one.
- **One hypothesis, one change, one test run.** Batched guesses in locking code produce a
  green suite that is still wrong.
- **Never widen a timeout to make a test pass.** `held > 200ms` is the test asserting
  contention behaviour. Raising it hides the bug.
- **Do not make the lock reentrant** as a shortcut for H1.
- **Failure mode if this is done carelessly:** silent tracker data loss under concurrent
  writes — two processes both believing they hold the lock. That is worse than a red test,
  and it is not detectable after the fact. This is the reason the plan is investigation-first.

---

## Already fixed (separate, unrelated)

`check-translation-freshness.mjs` added to `SYSTEM_PATHS` in `update-system.mjs`.
`node validate-system-paths-coverage.mjs` now exits 0 (was 1). That was the second of the two
suite failures and needs no further work.

---

*Drafted 2026-08-03 against `6528cc9`. The refuted hypothesis is recorded deliberately: the
next reader should not spend time re-checking the retry loop.*
