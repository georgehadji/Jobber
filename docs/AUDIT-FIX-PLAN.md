# Audit Fix Plan — 2026-10-21

Plan to fix every finding from the 2026-10-21 whole-repo audit (`/ponytail-audit`) and the
follow-up audit of the parts the first pass did not read. Written against Jobber's architecture
(`AGENTS.md`, `DATA_CONTRACT.md`): local-first, files as the source of truth, a system layer that
auto-updates and a user layer that must never be touched by an update, zero-auth providers behind
a host allowlist, and tests that can fail for their own reason.

Nothing here is implemented yet. Each workstream is one PR (merge commit, never squash: squash
merges invalidate the `modes/*` translation stamps).

---

## 0. Ground rules for every workstream

- **Layer discipline.** Fixes go in system-layer files only. No workstream edits `cv.md`,
  `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `portals.yml`, `data/*`,
  `reports/*`. Migrations of user data (e.g. re-keying a blacklist) happen at read time, never by
  rewriting the user's file.
- **New system files** are registered in `update-system.mjs` `SYSTEM_PATHS` in the same PR (the
  SYSTEM_PATHS coverage guard fails otherwise). `web/` is a separate release component
  (`web-vX.Y.Z`) and is not in `SYSTEM_PATHS`; web fixes ship through its own release.
- **Tests** live in `tests/**/*.test.mjs` (auto-discovered), use `pass`/`fail`/`warn` from
  `tests/helpers.mjs`, and follow the six rules in `AGENTS.md` → *Writing Assertions*: run the
  control case, assert identity not count, capture the reason, spawn the script for runtime guards
  reachable from an entry point, keep fixture setup failures as `warn()`, and build self-matching
  fixture strings by concatenation. Every finding below names the one test that would fail if the
  fix regressed.
- **Facts, not verdicts** and **never submit without review** (`AGENTS.md` → Ethical Use) are hard
  constraints on the web apply driver work.
- **Shortest correct diff.** Prefer deleting a private copy and importing the shared one over
  patching both. Where a helper already exists (`lib/file-lock.mjs`, `tracker-utils.mjs`
  `writeFileAtomic`, `providers/_html-entities.mjs`, `scan-ats-full.mjs` `withTimeout`,
  `scan.mjs` `foldCompanyName`, `followup-seed.mjs` row writer), reuse it.
- **Verification per PR:** `node test-all.mjs --quick`, `node test-runner.mjs --parallel 4`,
  `npx tsc --noEmit`; for `web/` also `npm run build` and the new route tests; for `dashboard/`,
  CI's Go job (no local Go toolchain on the maintainer machine).

## 1. Finding index

IDs are stable; workstreams below reference them.

### 1a. Main report — must fix (1–9)

| ID | Finding | Where |
|----|---------|-------|
| 1 | Web API has no Origin/Host/CSRF check; server listens on all interfaces. Confirmed: Next 16.2.12 guards only `/_next` and `/__nextjs` in `next dev`, nothing for `/api/*`, never checks `Host` | `web/src/app/api/**`, `web/package.json:6-8` |
| 2 | `/api/run` feeds unvalidated `kind`/`input` into a Bash-enabled agent; `"` breaks `verify-portals.mjs --add "${input}"` | `web/src/app/api/run/route.ts:18-74` |
| 3 | `plugins.mjs remove ../data` recursively deletes outside `plugins.local/` | `plugins.mjs:290-298` |
| 4 | Updater merges the remote `SYSTEM_PATHS` unfiltered; a user path in it is overwritten and exempted from the safety check | `update-system.mjs:996-1007, 1113` |
| 5 | `dedup-tracker.mjs` has no rank for `Hired`/`contratado`; a Hired row can be deleted | `dedup-tracker.mjs:33-55` |
| 6 | Company key strips every non-Latin letter → `''` (merge, dedup, outcome, set-status, scan cooldown, blacklist, `lib/company-name.mjs`) | `tracker-utils.mjs:49-51`, `dedup-tracker.mjs:68-74`, `lib/company-name.mjs:47` |
| 7 | Ashby salary parser reads a flat shape; live API uses `summaryComponents[]`/`currencyCode` → salary always null | `providers/ashby.mjs:38-76` |
| 8 | Web portals POST replaces a malformed `portals.yml` with the example template | `web/src/app/api/portals/route.ts:32-53` |
| 9 | `outcome.mjs` substring company fallback + hard-coded `--force` | `outcome.mjs:170-177, 385-392` |

### 1b. Main report — should fix (10–20)

| ID | Finding | Where |
|----|---------|-------|
| 10 | Re-eval discards existing notes; a second same-batch update is dropped; same-batch new rows double-insert | `merge-tracker.mjs:804-821` |
| 11 | Merge archives malformed / failed TSVs into `merged/` | `merge-tracker.mjs:896-905` |
| 12 | Board-wide providers in `tracked_companies` (freehire, eures) become false "employer boards" | `lib/employer-board.mjs:72-91`, `scan.mjs` employer snapshots |
| 13 | `assertPublicHttpsUrl` accepts trailing-dot hosts (`https://localhost./`) | `lib/ats-detect.mjs:50-53` |
| 14 | `detectBoard` takes the first claimed ATS link (a competitor's) and stops on an empty first page | `lib/ats-detect.mjs` `detectBoard`, `discover-ats.mjs:494-520` |
| 15 | Jobs with `url:''`/non-http URL reach `pipeline.md` and poison dedup; null array elements crash boards | `scan.mjs:2299-2396`, lever/ashby/greenhouse |
| 16 | 429 counts toward the dead-portal streak; per-host rate limit never enabled | `scan.mjs:2270`, `lib/http-errors.mjs`, `providers/_http.mjs:93` |
| 17 | softgarden follows redirects (blind SSRF) | `providers/softgarden.mjs:57,148` |
| 18 | `apply` stages the deleted, gitignored `.update-dismissed` → commit fails; failed `npm install` still reports "Update complete" | `update-system.mjs:1170-1202` |
| 19 | `add-entry.mjs` writes `cv.md` non-atomically, unlocked, and collapses blank lines CV-wide | `add-entry.mjs:215-236` |
| 20 | Web follow-up log writes bullets the CLI never parses; newline injection in `company`/`num` | `web/src/app/api/followups/log/route.ts:18-29` |

### 1c. Main report — the 15 smaller findings (s1–s15)

| ID | Finding | Where |
|----|---------|-------|
| s1 | Updater overwrites uncommitted edits in system paths users are told to customise (`templates/`, `modes/de/`) | `update-system.mjs:923-1018` |
| s2 | Mid-apply failure leaves a half-updated, staged tree; backup branch never printed | `update-system.mjs:971-1030, 1183-1225` |
| s3 | Rollback swallows commit failure, takes no lock, overwrites dirty files | `update-system.mjs:1262-1346` |
| s4 | `apply` installs `main` HEAD (not the version `check` reported) and runs `npm install` lifecycle scripts | `update-system.mjs:961-972, 1171` |
| s5 | Web `addOffersToPipeline` reports success before the async write; failures orphan offers in scan history | `web/src/lib/core/pipeline.ts:43-57` |
| s6 | Web memory/runs persist client text later inlined into agent prompts; `rememberFact` is a non-atomic RMW | `web/src/app/api/memory`, `runs/save`, `lib/jobber.ts:279-306` |
| s7 | No tests for any mutating web route | `web/` |
| s8 | `merge-tracker` `buildRow` emits fixed legacy column order and drops custom columns; `--migrate-via` drops notes on rows without a trailing pipe | `merge-tracker.mjs:341-348, 557-569` |
| s9 | `followup-seed.mjs` has a weaker private copy of `lib/file-lock.mjs` (leaves ownerless lock dirs) | `followup-seed.mjs:295-383` |
| s10 | `sameOpening` tokenizer drops CJK/Cyrillic; `back-end` ≠ `backend` | `lib/employer-board.mjs:33-62` |
| s11 | `fetchPage` buffers the whole body before capping; redirect bodies never cancelled | `lib/ats-detect.mjs` `fetchPage` |
| s12 | Salary 0 treated as data by `salary_filter` (placeholder "0–0" dropped); `agentic-jobs` accepts 0/negatives | `scan.mjs:583-607`, `providers/ashby.mjs:48-54`, `providers/agentic-jobs.mjs:111-120` |
| s13 | `scan.mjs` has no per-company watchdog; a non-Error rejection aborts the whole run | `scan.mjs:2268-2407`, `providers/workday.mjs:84-100` |
| s14 | `[`/`]`/`\` backslash-escaped inside pipeline URLs; `--md-out` digest unsanitised; headerless legacy `scan-history.tsv` loses its first row from dedup | `scan.mjs:963, 1384-1388`, `scan-ats-full.mjs:922-935` |
| s15 | Provider contract test never checks the Job shape; parsers tested only against invented fixtures | `tests/providers/_contract.test.mjs` |

Also folded into the workstreams (minor, from the same reports): CRLF trackers get mixed line
endings after a row rewrite; `dedup-tracker`/`normalize-statuses` overwrite a single `.bak`; three
divergent status-alias tables; `plugins.mjs add --confirm` enables before the capability card.

### 1d. Follow-up audit — parts not read in the first pass (N1–N44)

**Providers (95 skimmed files, now read):**

| ID | Sev | Finding | Where |
|----|-----|---------|-------|
| N1 | must | hackernews custom 7-entry decoder misses `&#x2F;` → all 341 jobs get the thread URL and dedup to one | `providers/hackernews.mjs:38-75,107` |
| N2 | must | `_html-entities.mjs` looks names up on a plain object → `&constructor;` decodes to `function Object()…` (affects every user) | `providers/_html-entities.mjs:34` |
| N3 | must | csod `homeUrl` fetch lacks `redirect:'error'` and allows `http:` (bearer token in clear) | `providers/csod.mjs:44,149` |
| N4 | must | cryptocurrencyjobs: `catch { return [] }` hides outages; `<link>` not validated (relative, `javascript:`) | `providers/cryptocurrencyjobs.mjs:72-115` |
| N5 | must/should | Null array elements crash the whole board: amazon, alibaba, gem, recruitee, smartrecruiters, meituan, tencent; numeric `id` crashes glints, jobstreet | listed files |
| N6 | should | Empty title / relative URL emitted: amazon, recruitee (test pins `url:''`), smartrecruiters, solidjobs, oraclecloud, local-parser (any scheme) | listed files |
| N7 | should | First-page failure swallowed → dead board reads as "0 jobs": phenom, radancy, successfactors | `phenom.mjs:186`, `radancy.mjs:357`, `successfactors.mjs:326` |
| N8 | should | Silent truncation at default page caps with no warning: hrmos, adp, adpmyjobs, herp, hiringroom, eures, arbetsformedlingen, hrmanager, jobscore, ibm, paycom, solides, talentlyft, thehub, jobstreet; paycom/solides ignore `entry.max_pages` | listed files |
| N9 | should | Hand-rolled entity decoders that double-unescape or skip CDATA: higheredjobs, jobspresso, larajobs, nodesk, personio, taleobe, teamtailor, weworkremotely, trakstar; radancy private copy with the old `&#12a;` bug; talentlyft decode→strip→decode | listed files |
| N10 | should | gem detail batch unbounded; failure silently drops `postedAt`/`description` for the board | `providers/gem.mjs:184-196` |
| N11 | should | jobstreet hard-codes `/id/job/` for sg/my/seek markets (verify live) | `providers/jobstreet.mjs:122` |
| N12 | nice | glints/careerplug/freshteam page caps unclamped or `NaN`-fragile; nofluffjobs `postedAt: 0` for null; `postedAt: undefined` keys; whitespace-only titles pass (bamboohr, breezy); rheinmetall `decodeURIComponent` URIError; oraclecloud finder params unencoded; nodesk/weworkremotely title splitting; jibeapply null later page | listed files |

**Web routes and apply driver:**

| ID | Sev | Finding | Where |
|----|-----|---------|-------|
| N13 | must | Submit guard: a failed `fill` falls back to `keyboard.type` (newline = implicit submit); `pressSequentially` types `\n`; `SUBMIT_RX` misses Apply/Send/Confirm/Absenden/Envoyer/Soumettre/Invia/Postuler; no structural `type=submit` check; `act.ref` interpolated into a selector | `web/src/lib/apply/{drive,session,submit-guard}.ts` |
| N14 | should | Apply session opens any http(s) URL (loopback, metadata, LAN) and returns screenshots → SSRF with readback; `tryApplyTrigger` follows any `/apply` link | `apply/session/route.ts:19`, `lib/apply/session.ts`, `diagnose.ts:96-100` |
| N15 | should | No origin pinning: answers, PII and the CV follow the page to any host | `lib/apply/drive.ts:189-214`, `session.ts:395-411` |
| N16 | should | Agents with `Read/Glob/Grep` + `WebFetch/WebSearch` fed untrusted text can exfiltrate `cv.md`/`profile.yml` | `api/assistant/route.ts:105-108`, `api/explore/ai/route.ts:71-74` |
| N17 | should | Tool denylists stale (`Task` not `Agent`, no `PowerShell`/`Skill`), `--permission-mode acceptEdits` everywhere, non-Claude CLIs unrestricted | `lib/clis.ts`, 6 routes |
| N18 | should | `/api/status` edits the tracker itself, no lock, no ledger, first-match on duplicate `#` | `api/status/route.ts:32-73` |
| N19 | should | Wrong-company CV attached (first-token substring match; cover letters match too) | `lib/apply/cv.ts:24-29` |
| N20 | nice | No abort on client disconnect (drive, explore, prefill); `SESSIONS` uncapped; uploads uncapped; `/api/logo` cache grows per domain; tracker-write flag leaks if `spawn` throws | listed files |

**`scan.mjs` 1–545, plugin network/lock/audit:**

| ID | Sev | Finding | Where |
|----|-----|---------|-------|
| N21 | must | Shipped `title_filter.negative` `"Java "` (trimmed → substring) and `"Intern"` block JavaScript, Internal, International roles; `content_filter` `rust` matches "trust" | `scan.mjs:89-106, 400-402`, `templates/portals.example.yml:316,318` |
| N22 | must | `plugin-audit.mjs` misses `export … from`, `process.getBuiltinModule`, non-literal `import()`, and relative imports escaping the plugin dir | `plugin-audit.mjs:33-34,118-137` |
| N23 | must | `node_modules` skipped by both the audit and the integrity hash → unaudited, undetected code | `plugin-audit.mjs:52,67`, `plugins/_lock.mjs:45` |
| N24 | should | `lockGate` trusts author-controlled `version` for `legit-update`; hooks/optionalEnv not in the surface diff; corrupt lock → empty → auto re-pin | `plugins/_lock.mjs:63-115`, `_engine.mjs:558-575` |
| N25 | should | `classifySource` says `approved` without a matching `sha`; `repin` drops `sha`/`repo`; successor shadowing trusts the lock alone | `plugins/_registry.mjs:81-87`, `_engine.mjs:307-311,561-564` |
| N26 | should | No env/egress control for plugins without `requiredEnv` (empty `allowedHosts` = any host; `process.env` unflagged) | `plugin-audit.mjs:27-31`, `_engine.mjs:380` |
| N27 | nice | `isBlockedIp` IPv6 gaps (`fe80::/10`, `fec0::/10`, `64:ff9b::/96`, `2002::/16`, v4-compat) and `198.18.0.0/15`; redirect keeps `x-api-key`-style headers; no body cap; timeout cleared before body read | `plugins/_net.mjs:37-44`, `_engine.mjs:408` |
| N28 | should | Filter config typos/wrong types silently disable filters; `positive: []` passes all; `--company` last arg = all companies, `--company Meta` = Metabase; `--posted-after` last arg ignored | `scan.mjs:100-106, 280-283, 2035-2104` |
| N29 | should | Non-Latin cooldown: two empty folded names compare equal → every CJK company cooled down; blacklist rows with non-Latin names dropped; `Nørgaard`≠`Norgaard` | `scan.mjs:643-646, 1709-1723` |
| N30 | should | Country eligibility: only the exact `united states` disables it (USA/US rejected); candidate-country match has no word boundary (`US` ⊂ "business") | `scan.mjs:459,471` |
| N31 | nice | URL-slug location hint reads a title slug; decomposed Unicode bypasses `block`; `max_posting_age_days: 30.5` disables the filter | `scan.mjs:210-230` |

**Go dashboard and batch runner:**

| ID | Sev | Finding | Where |
|----|-----|---------|-------|
| N32 | must | `IFS=$'\t' read` collapses the empty error field → score always `-`, `--min-score` dead, averages never shown (same at `:948`) | `batch/batch-runner.sh:666, 948` |
| N33 | must | `&` in a URL is a sed backreference → mangled `**URL:**` in reports | `batch/batch-runner.sh:522-535` |
| N34 | should | `--status`/`--dry-run`/`--watch` run the EXIT trap and delete the live runner's lock; `acquire_lock` is check-then-write | `batch/batch-runner.sh:145-167, 895-911` |
| N35 | should | Report-number reservation fails open (empty number → worker computes max+1, the #749 race) and WARN text leaks into the captured number | `batch/batch-runner.sh:220-248, 461-491` |
| N36 | should | Runner always `exit 0`; dead workers leave `processing` rows; `log_discard` is never called and the pre-screen gate `modes/batch.md` describes is not implemented | `batch/batch-runner.sh:367, 1060-1099` |
| N37 | should | Parallel same-company workers overwrite each other's `cv-candidate-{slug}.html`; stray fence and duplicate `## Machine Summary` in the prompt; TSV filename doc drift | `batch/batch-prompt.md:355-515`, `modes/batch.md:140` |
| N38 | should | Go parser counts Prettier/Obsidian separator rows as phantom applications; alias table hand-copied from `tracker-aliases.json` | `dashboard/internal/data/career.go:78-100, 600-606` |
| N39 | should | Report-link path traversal: `[1](../../../.ssh/id_rsa)` is read and rendered | `career.go:38-50, 150, 534`, `ui/screens/pipeline.go:592` |
| N40 | should | No allowlist before `ShellExecute`/`xdg-open`: `HasPrefix(u,"http")` accepts `httpx://`, `http.exe`; pdf-index paths not required to end in `.pdf` | `dashboard/open_*.go`, `career.go:211-409`, `pdf.go:34-46` |
| N41 | should | Any tab in a pipe row flips the splitter to tab mode → columns shift, writer patches the wrong cell | `career.go:579, 757, 805` |
| N42 | nice | Go `UpdateApplicationStatusAndNotes` matches the first `[N]` anywhere (incl. Notes); `SaveAnonymousStat` unescaped/non-atomic/unused; WARN to stderr corrupts the TUI; viewer renders raw ESC/OSC sequences; `file://` link with unencoded spaces; gofmt drift | `dashboard/**` |
| N43 | nice | Batch JD temp file is created empty and never used/removed; MSYS `/tmp` path given to native Windows tools; `429`/"usage limit" grep over the whole log (false rate-limit pauses); `.resolved-prompt-N.md` not removed by the trap; `read` loops drop a last unterminated line; CRLF `\r` breaks retry arithmetic | `batch/batch-runner.sh` |
| N44 | nice | `aggregate-tokens.mjs` cost always "n/a" (no token line in `claude -p` logs; fallback overwrites instead of summing) | `batch/aggregate-tokens.mjs` |

---

## 2. Shared primitives first (Workstream A)

Many findings are one rule implemented in several places. Fix the rule once, delete the copies,
then the per-module workstreams become small. **Paradigm: pure functions with table-driven tests;
single source of truth.**

| Primitive | Replaces / fixes | Design |
|-----------|------------------|--------|
| `normalizeCompany(name)` in `tracker-utils.mjs` becomes Unicode-aware: `name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')`. `lib/company-name.mjs` `normalizeCompanyName` keeps its suffix stripping but uses the same character class. Callers treat `''` as "no key" (never equal to another `''`). | 6, N29, part of 9 and 12 | Pure function. `dedup-tracker.mjs` deletes its private copy and imports it. Compatibility: Latin keys are unchanged (`[a-z0-9]` ⊂ `[\p{L}\p{N}]` after lowercasing; diacritics are kept, so add an NFD+strip-marks fold in the *comparison* helper `foldCompanyName` already used by scan, not in the stored key). Test: table of Latin/Cyrillic/CJK/Arabic/diacritic names asserting exact keys, plus the control that two different CJK names produce different keys. |
| `isHttpUrl(u)` (new, `lib/url-guard.mjs`): `try { const p = new URL(u); return p.protocol === 'https:' \|\| p.protocol === 'http:'; } catch { return false; }` | 15, N4, N6, N40 (Node side), local-parser | Pure predicate. |
| `finalizeJobs(providerId, jobs)` (new, `providers/_finalize.mjs`) applied by `providers/_registry.mjs` around every `provider.fetch()` | 15, N5 (partly), N6, s12, N12 (whitespace titles, `postedAt` 0/undefined) | **Decorator** over the Provider interface: drops non-objects, rows without a trimmed title, rows failing `isHttpUrl`; deletes `postedAt` when not a positive finite number; drops `salary` unless all three keys are present with `null`-or-positive bounds; counts and warns once per provider (`console.error('<id>: dropped N malformed postings')`). Providers keep their own parsing; the contract is enforced in one place, so fixing ~15 providers' `url:''` becomes zero per-provider edits. Per-provider fixes remain only where the crash happens *inside* the provider's own mapping (N5). |
| `compact(arr)` helper in `_finalize.mjs` (`(Array.isArray(arr) ? arr : []).filter(x => x && typeof x === 'object')`) | N5, 15 (lever/ashby/greenhouse), jibeapply | One-line guard each provider calls before mapping. |
| `warnTruncated(id, {got, total, cap})` in `_finalize.mjs` | N8 | Uniform message, matching the existing radancy/a16z wording. |
| `decodeEntities` fix: `Object.hasOwn(NAMED_ENTITIES, k)` (or `Object.create(null)` map) | N2 | One line, test with `&constructor;`, `&__proto__;`, plus the control `&amp;`. |
| `decodeXml(text)` (new, in `_html-entities.mjs`): single-pass regex over the five XML entities + numeric, CDATA-aware, then `decodeEntities` for HTML bodies | N1, N9 | Replace all nine hand-rolled decoders and radancy's private copy. Deletion-heavy (≈150 lines). Test: `R&#38;lt;b&#38;gt;` → `R&lt;b&gt;`, `<![CDATA[Sales &amp; Marketing]]>` → `Sales & Marketing`, `&#x2F;` → `/`. |
| `withTimeout(promise, ms, label)` moved from `scan-ats-full.mjs` to `lib/with-timeout.mjs` | s13 | Imported by both scanners. |
| `isBlockedAddress(ip)` (new, `lib/net-guard.mjs`): parses v4 and v6 to bytes, blocks loopback, private, CGNAT, link-local `fe80::/10`, site-local `fec0::/10`, ULA, NAT64 `64:ff9b::/96`, 6to4 `2002::/16` (embedded v4 checked), v4-mapped/compat, `198.18.0.0/15`, multicast, unspecified. `normalizeHost(h)` strips a trailing dot and lowercases. | 13, N27, N14 (web uses the same logic via a small TS port or by importing the `.mjs`), ats-detect | Pure, byte-level, table-driven test of ~30 addresses incl. the reported bypasses and controls (`8.8.8.8`, `2606:4700::1111` allowed). `plugins/_net.mjs` and `lib/ats-detect.mjs` both import it; `_net.mjs`'s own `isBlockedIp` is deleted. |
| Status ranking from `templates/states.yml` | 5, divergent alias tables | `tracker-utils.mjs` exports `statusRank(label)` built from `states.yml` order + aliases, with `Hired` highest; `dedup-tracker.mjs` and `normalize-statuses.mjs` import it instead of their own tables. Test: every canonical state and alias has a rank; Hired > Offer > … ; control: an unknown status ranks below Evaluated and is reported. |

New files registered in `SYSTEM_PATHS`: `lib/url-guard.mjs`, `lib/with-timeout.mjs`,
`lib/net-guard.mjs`, `providers/_finalize.mjs` (covered by `providers/`), their tests.

---

## 3. Workstreams

Order = risk × blast radius. B and C are security and come first; D–F protect user data.

### B. Web app request boundary — 1, 2, 8, 20, s5, s6, s7, N16–N20

**Paradigm: one guard at the edge (Chain of Responsibility / middleware) + schema-validated
handlers ("parse, don't validate") + least-privilege capability table.**

1. `web/src/proxy.ts` (Next 16 request proxy, the successor of `middleware.ts`): for every
   non-GET/HEAD request reject with 403 unless
   - `Host` hostname ∈ {`localhost`, `127.0.0.1`, `[::1]`} (port ignored) — blocks DNS rebinding;
   - `Origin`, when present, has the same host:port as `Host`; when absent, `Sec-Fetch-Site` is
     absent or `same-origin`/`none`;
   - `Content-Type` is `application/json` (forces a CORS preflight for any cross-site attempt) —
     except the one multipart upload route (`cv/ingest`), which is covered by the Origin rule.
   `package.json`: `next dev -H 127.0.0.1`, `next start -H 127.0.0.1`.
2. Per-route input schemas in one file `web/src/lib/core/validate.ts` (hand-written type guards,
   no new dependency): each mutating route parses its body through its guard and returns 400 on
   failure. `/api/run`: `kind` ∈ `{evaluate, research, pdf, fix-portal}` (a lookup table of
   `{validate, buildPrompt, tools}` — **Strategy pattern**, replaces the if-chain);
   `input` must match `^https?://\S{1,2000}$` (evaluate/research), `^\d{1,4}$` (pdf),
   `^[\p{L}\p{N} .&'()-]{1,80}$`u (fix-portal). The fix-portal prompt passes the name as data
   (quoted block), never inside a shell command string.
3. Agent capability policy `web/src/lib/agent-policy.ts`: one table per route kind giving the
   exact `--tools` allowlist and no `--permission-mode acceptEdits` unless the kind writes
   (evaluate/pdf write reports; research/assistant/explore never). Rules (N16, N17): no run gets
   both a file-read tool and a network tool; explore/ai keeps `WebSearch,WebFetch` and loses
   `Read,Glob,Grep` (its prompt already inlines memory/dedup); assistant loses `WebFetch`;
   `agent-interpret` gets no tools at all. Denylist adds `Agent, PowerShell, Skill, Task`.
   Non-Claude CLIs: routes that rely on tool scoping refuse non-Claude `cliId` with a clear
   message until each CLI's sandbox flags are verified (documented in `docs/`).
   Untrusted text (memory notes, page context, job labels) is wrapped in a fenced
   `<untrusted>` block with an instruction to treat it as data (s6).
4. File writers:
   - portals (8): copy the profile route's guard — exists + parse error → 409, no write.
     `yaml.dump` comment loss: switch both writers to the `yaml` package's `Document` API
     (already a transitive dependency of Next? verify; if not, keep js-yaml and document the
     limitation) so comments survive. Keep one `.bak` (overwrite), not one per write.
   - profile: type-check `roles`/`name` fields in `patchToProfile`.
   - followups/log (20): strip `\r\n` from every field; write the same table row
     `followup-seed.mjs` writes by spawning it (argv array) — one writer for the file
     (**single writer** rule, same as `set-status.mjs` for the tracker).
   - status (N18): spawn `node set-status.mjs <n> <state> --json` and map exit codes (3 ambiguous
     → 409, 4 lock busy → 423). Delete the route's own string editing.
   - pipeline (s5): `await appendToPipeline(offers)` before `appendToScanHistory`; report
     `added` only after both resolve.
   - memory (s6): `rememberFact` takes the shared file lock (spawn a tiny Node helper or port
     `lib/file-lock.mjs` semantics) and writes atomically.
   - cv/ingest, logo (N20): size cap (5 MB upload, 24 000-char text), logo cache keyed by a
     validated hostname with an LRU cap.
5. Long-running routes (N20): honour `req.signal` — abort the drive loop, kill the explore/prefill
   child on `cancel()`; cap `SESSIONS` at 3 with LRU close; `run/route.ts` wraps `spawn` in
   `try/finally` around `acquireTrackerWrite()`.
6. CV attach (N19): match the full company slug with a filename boundary
   `(^|[-_])slug([-_.]|$)`, skip `cover*` files, and return "no tailored CV" instead of guessing.
7. Tests (s7): `web/tests/*.test.mjs` with `node:test`, importing the route handlers with a temp
   `JOBBER_ROOT`: proxy rejects foreign Origin, foreign Host, `text/plain`; accepts same-origin
   JSON (control). `/api/run` rejects a newline/`"` input (and accepts a plain URL — control).
   portals/profile with a malformed file → 409 and the file is byte-identical afterwards.
   followups/log with `\n` in company → one table row, parsed by `followup-cadence.mjs`
   `parseFollowups` (assert identity of the parsed row). status → the tracker row changes and a
   `status-log.tsv` line exists (proves it went through set-status).

### C. Web apply driver — N13, N14, N15

**Paradigm: invariant checks before every side effect (guard object), pure core / imperative
shell.** The driver never submits; that is a product rule, so the guard must fail closed.

1. `SubmitPolicy.assertSafeClick(loc)` replaces the label regex as the primary check:
   `loc.evaluate(el => ({ submitLike: el.matches('[type=submit],[type=image],button:not([type])') && !!el.form, label: … }))`.
   Refuse when `submitLike`, when the label matches the extended multilingual `SUBMIT_RX`
   (add Apply, Send, Confirm, Done, Absenden, Bewerbung abschicken, Envoyer, Soumettre, Postuler,
   Invia, Candidati, 送信, 応募, Отправить; sources add `aria-labelledby` text, `title`, `alt`),
   or when the label is empty (unknown → refuse).
2. Typing never presses Enter: every typed/filled value has `\r\n` stripped; the `fill` fallback
   uses `pressSequentially` on the stripped text; `session.ts` combobox path the same.
3. `act.ref` must match `/^e\d+$/` before it reaches a selector.
4. Origin pin (N15): record the registrable host of the first URL (or the matched ATS host
   allowlist) in the session; before any `type`, `select`, `setInputFiles` or `click`, compare
   `page.url()` and the frame URL host; mismatch → `stuck` with "page left the application site".
5. SSRF (N14): `openSession` resolves the hostname and rejects blocked addresses via the
   `net-guard` rule (Workstream A); `page.route('**/*')` aborts top-level navigations to blocked
   addresses (covers redirects and `tryApplyTrigger`); `tryApplyTrigger` only follows same-host
   links.
6. Tests: extend `web/test-submit-guard.mjs` to a Playwright-free unit test of the policy over a
   jsdom-free fake element descriptor table (submit button with empty label, `<input type=image>`,
   localized labels, control: "Upload résumé" allowed); a test that the typed value sent to the
   page contains no `\n`; a test that `x"],button` refs are rejected.

### D. Updater and plugins — 3, 4, 18, s1–s4, N22–N27

**Paradigm: fail-closed state machines; Saga with compensation for multi-step apply; pure path
filters.**

1. `plugins.mjs remove` (3): validate `id` with the engine's `ID_RE`, resolve `dir` and require
   `isWithinDirectory(plugins.local, dir)`; refuse otherwise. Spawned test: `remove ../data`
   exits non-zero and a sentinel file in a temp `data/` still exists; control: removing a real
   temp plugin succeeds.
2. Remote path filter (4): pure `sanitizeRemotePaths(remote, {user: USER_PATHS})` drops entries
   that are `.`, absolute, contain `..`, start with `:`, or equal/sit under a user path; logs each
   drop. Step-4 safety check exempts only *local* `SYSTEM_PATHS`. Unit test over a remote list
   containing `cv.md`, `data/`, `.`, `../x`, plus a legitimate new path (control: kept).
3. Apply as a Saga (s2): steps 3–7 inside one `try`; on any throw call
   `revertPaths(updated, initialStatusPaths)`, print `Backup: <branch> — recover with node
   update-system.mjs rollback`, exit 1. The re-exec stage reverts the staged updater if the child
   fails.
4. Dirty-path guard (s1, s3): before checkout, intersect `initialStatusPaths` with `updatePaths`;
   non-empty → list them and abort unless `--force`. Rollback reuses the guard and takes the same
   `.update-lock`.
5. Commit step (18): never stage `.update-dismissed`; just unlink it. Rollback distinguishes
   "nothing to commit" (`git diff --cached --quiet`) from a real commit failure and rethrows.
6. Install step (18, s4): collect install failures into a result list printed in the final
   summary ("Update applied, but dependencies NOT installed — run npm install"), exit code 2.
   `npm install --ignore-scripts`; print the fetched commit SHA; fetch the release tag
   `jobber-v<remote>` that `check` reported when it exists, falling back to `main` with a
   warning.
7. Plugin audit (N22, N23): flag `export … from` of forbidden modules, non-literal `import()`,
   `getBuiltinModule`, `createRequire`, `process[`/`process.binding`/`dlopen`, `process.env`
   reads (N26); resolve every relative specifier and require it to stay under the plugin dir; stop
   skipping `node_modules` in both `plugin-audit.mjs` and `_lock.mjs` (community plugins with
   `node_modules` are rejected with a message; bundled ones are hashed including it).
   Note in code that a static audit is a speed bump, not a sandbox (AGENTS.md rule 6 style).
8. Lock gate (N24, N25): a fail-closed state machine — unreadable lock → refuse to load (not
   "empty"); `unpinned` auto-pins only when the lock file is absent; `legit-update` for
   non-bundled plugins requires `plugins.mjs trust`; surface diff includes `hooks` and
   `optionalEnv`; `repin` spreads the old entry so `sha`/`repo` survive; `classifySource`
   returns `unverified` unless `lockEntry.sha === registry.sha`. `add --confirm` shows the
   capability card before enabling.
9. Egress (N26, N27): community plugins must declare non-empty `allowedHosts`; redirect handler
   strips every non-safelisted header on host change; body capped (5 MB) and the timeout covers
   the body read.
10. Tests: `tests/plugin-audit-bypass.test.mjs` with one fixture plugin per bypass (strings built
    by concatenation per rule 6) and a clean control; `tests/plugin-lock-gate.test.mjs` covering
    corrupt lock, stripped integrity, version-bump-with-new-hooks (each must refuse) and a
    genuine bundled update (control: loads); updater tests for `sanitizeRemotePaths`, the
    dismiss-then-apply commit, and an injected checkout failure leaving the tree clean.

### E. Tracker writers — 5, 6, 9, 10, 11, 19, s8, s9

**Paradigm: Unit of Work under one lock (read → pure transform → atomic write inside the lock);
rows patched as cell arrays by header index, never rebuilt from a fixed layout.**

1. Primitives from Workstream A land first (Unicode `normalizeCompany`, `statusRank`).
2. `dedup-tracker.mjs` (5): imports `statusRank`; Hired/Offer/Interview rows are never removed by
   fuzzy clustering. Test: Hired 3.9 vs Evaluated 4.2 same company/role → Hired row survives with
   status Hired (identity, not count); control: two Evaluated rows still dedup.
3. `outcome.mjs` (9): remove the substring fallback (exact key, or numeric selector); pass
   `--force` only when the user passed it. Spawned test: `outcome Meta rejected` with only a
   "Metabase" row exits not-found; `outcome 12 no_response` on a Hired row is refused by
   set-status's terminal guard.
4. `merge-tracker.mjs`:
   - (10) re-eval notes = `Re-eval … | ` + old notes; after each in-place update refresh
     `duplicate.raw/score/notes`; push newly added rows into `existingApps`. Test: two TSVs for
     one existing row in one batch → final row has the higher score and both are logged once;
     two TSVs for one new row → one insert.
   - (11) archive only files that were merged or deliberately deduped; malformed/failed TSVs stay
     in `batch/tracker-additions/`. Test asserts the malformed file's path still exists.
   - (s8) replace `buildRow` with `patchCells(line, COLMAP, changes)` (the `set-status.mjs`
     approach): split the original line, write only the changed cells, keep unknown columns and
     the header's order. `--migrate-via` pops the last element only if it is empty. Preserve the
     file's dominant line ending (CRLF in → CRLF out).
5. `add-entry.mjs` (19): read → transform → `writeFileAtomic` inside `acquireLock` from
   `lib/file-lock.mjs`; the blank-line collapse applies only to the rebuilt section. Test: a CV
   with intentional triple blank lines elsewhere is byte-identical outside the edited section.
6. `followup-seed.mjs` (s9): delete the private lock (≈90 lines) and call `acquireLock` with its
   lock dir. Test: a simulated `owner.json` write failure leaves no lock directory.
7. `.bak` handling in `dedup-tracker`/`normalize-statuses`: timestamped `.bak-<iso>` keeping the
   last 5.

### F. Scanner core and filters — 12, 15, 16, s12, s13, s14, N21, N28–N31

**Paradigm: parse config once into a normalized, validated object (warn on unknown keys and wrong
types) and build pure predicate functions from it; table-driven tests per predicate.**

1. Config normalization (N28): `normalizeScanConfig(raw)` returns `{titleFilter, locationFilter,
   contentFilter, salaryFilter, …, warnings[]}`; unknown keys and non-array lists produce a
   warning line at scan start (exit non-zero under `--strict`). `title_filter.positive: []` means
   "no positive filter" and the docs say so (the current behaviour), or is rejected — pick the
   documented one (`portals.example.yml:263` says at least one must match → reject with a
   warning). CLI: a flag missing its value is an error; `--company` matches exactly (folded).
2. Keyword compiler (N21): do not trim before deciding the boundary; a trailing/leading space
   means a word edge; keywords of ≥4 letters are matched with `\b…\b` unless they contain
   regex-like wildcards the docs define. Fix the shipped template defaults: `"Java"` with
   `(?!script)` semantics via the boundary rule, `"Intern"` → `"Internship"` and
   `"Intern "`/`" Intern"`. Content filter uses the same compiler (`rust` ≠ "trust"). Table test:
   the four reported titles pass; "Java Developer", "Summer Intern" are blocked (controls).
3. Country eligibility (N30): alias table for the US (`us`, `usa`, `u.s.`, `united states of
   america`, …) before the no-op check; candidate-country match via `compileLocationKeyword`.
4. Cooldown/blacklist (N29): equality on folded names returns false when both are empty; blacklist
   keys use `foldCompanyName` + the Unicode normalizer; rows that normalize to empty are reported,
   not silently dropped. Decomposed Unicode is NFC-normalized before location matching (N31).
5. Job intake (15, s12): `finalizeJobs` (Workstream A) already drops url-less rows; `scan.mjs`
   additionally never writes a dedup key of `''`. Salary filter treats non-positive bounds as
   unknown (`pos = v => Number.isFinite(v) && v > 0 ? v : null`; both null → pass).
6. Resilience (16, s13): `classifyFetchError` maps 429 to `network` (neutral to the dead-portal
   streak); `makeHttpCtx({ rateLimitMs: 150 })` in `scan.mjs`; each company task wrapped in
   `withTimeout(…, 5 min)`; `err?.message ?? String(err)` in the catch; workday retries only
   numeric 429/5xx statuses.
7. Output (s14): percent-encode `[`, `]`, `\` in pipeline URLs instead of backslash-escaping;
   `--md-out` fields go through `sanitizeMarkdownField`; `loadSeenUrls`/`collectSeenCompanyRoles`
   skip line 1 only when it starts with `url\t`. Test: `https://x.com/a[1]` round-trips to a URL
   that `new URL()` parses to the same href.
8. `max_posting_age_days` accepts any positive number (N31); the URL-slug location hint is only
   used for path segments that look like locations (country/city table), not after `/job/`.

### G. Freehire-era code (this session's own) — 12, 13, 14, s10, s11

**Paradigm: keep the facts-not-verdicts rule — when coverage is uncertain, emit nothing.**

1. Employer snapshots (12): only providers declaring `scope: 'company'` (new optional field on the
   Provider interface in `providers/_types.js`; default `company` for per-company ATSes,
   `scope: 'search'` for freehire, eures, arbeitnow-style boards) are snapshotted. One-line field
   per board-wide provider, no registry logic beyond the filter. Test in
   `tests/employer-board.test.mjs` that drives the scan wiring with a search-scope entry and
   asserts no `employerBoard` stamp (and a company-scope control that does stamp).
2. `sameOpening` (s10): tokenize with `/[^\p{L}\p{N}+#]+/u` after removing hyphens inside words.
   Tests: `软件工程师` vs `软件工程师 (上海)` same; `Desarrollador Back-end` vs `Desarrollador
   Backend` same; controls stay different.
3. ats-detect (13, s11): `normalizeHost` + `isBlockedAddress` from Workstream A; `fetchPage`
   streams with a reader and aborts after `MAX_HTML_BYTES`, cancels redirect bodies. Tests add
   `https://localhost./`, `foo.internal.`, `printer.lan.` (rejected) with `example.com.`
   (accepted, control).
4. `detectBoard` (14): collect all claimed boards; prefer one whose slug folds to the company name
   or matches an `embed ?for=` hit; otherwise return it with `confidence: 'unverified'`, which
   `discover-ats.mjs` reports as unresolved with the candidate URL in the reason (no write to
   `portals.yml`). Try the next candidate page when the first yields no claim.

### H. Providers — 7, 17, N1–N12

**Paradigm: Template Method via the shared `finalizeJobs` decorator; per provider only the
source-specific parsing. Every fixture that encodes a guessed shape is replaced by a captured
real payload (committed under `tests/providers/fixtures/`).**

1. Ashby (7): read the `summaryComponents` entry with `compensationType === 'Salary'`
   (`interval`, `currencyCode`, `minValue`, `maxValue`); keep the flat shape as a fallback only
   if a captured payload shows it exists. Fixture: a trimmed real response.
2. Redirect/scheme (17, N3): softgarden and csod add `redirect:'error'`; csod and softgarden
   require `https:`. New contract test (`tests/providers/_contract.test.mjs`): run every
   provider's `fetch` with a hostile entry against a recording mock ctx; fail on any request
   whose options lack `redirect:'error'` or whose host is off the provider's allowlist, with an
   explicit, commented exception list for documented self-hosted tenants (avature, jibeapply,
   phenom, radancy, successfactors) that must still pass `redirect:'error'`.
3. Decoders (N1, N9): hackernews, higheredjobs and the eight others switch to `decodeXml` /
   `decodeEntities`; radancy deletes its private copy; talentlyft decodes once after stripping
   tags. hackernews test fixture includes `&#x2F;` and asserts the extracted URL.
4. Null and type guards (N5): `compact()` before mapping in amazon, alibaba, gem, recruitee,
   smartrecruiters, meituan, tencent, lever, ashby, greenhouse, jibeapply; `String(x ?? '')`
   for ids in glints and jobstreet.
5. Fail loud on the first page (N4, N7): cryptocurrencyjobs drops its `catch { return [] }`;
   phenom, radancy, successfactors rethrow when no page succeeded.
6. Truncation (N8): providers with a known total call `warnTruncated`; paycom/solides honour
   `entry.max_pages`; caps clamped (`Math.min`, `Number.isFinite`) in glints, careerplug,
   freshteam (N12).
7. Smaller (N10–N12): gem batches details in chunks of 50 and logs failures; jobstreet builds
   `/job/<id>` except on `id.` hosts (verify against one live SG and one SEEK URL before
   merging); nofluffjobs and friends rely on `finalizeJobs` for `postedAt`; rheinmetall wraps
   `decodeURIComponent`; oraclecloud validates `siteNumber`/`locationId`/`lang` against
   `/^[A-Za-z0-9_-]+$/`; recruitee's test stops pinning `url:''`.
8. Contract shape test (s15): `assertJobShape(job)` run over every provider's existing fixtures
   (title non-empty, url `isHttpUrl`, salary keys complete and annual-positive, `postedAt`
   positive or absent). This is the test that would have caught 7, 15 and N6.
9. `join.mjs` /100 for zero-decimal currencies and `agentic-jobs` period: verify against the
   API docs; fix only with evidence (the auditor could not confirm).

### I. Batch runner — N32–N37, N43, N44

**Paradigm: defensive shell — non-whitespace field separators, explicit ownership of shared state,
fail closed on missing invariants, aggregate exit status.**

1. (N32) The node snippet joins with `\x1f`; `IFS=$'\x1f' read -r …`; same for the input reader at
   `:948`. Test (`tests/batch-runner-parse.test.mjs`, spawns bash): a worker JSON with
   `"error": null` and score 4.2 yields score 4.2 (control: an error string with a tab still
   lands in the error field).
2. (N33) Escape `&` in `esc_url` and `esc_jd_file`. Test: URL `…?a=1&b=2` appears verbatim in the
   resolved prompt.
3. (N34) `LOCK_HELD=1` set in `acquire_lock`; `release_lock` returns unless set; `acquire_lock`
   uses `set -o noclobber` for the PID write.
4. (N35) All WARN/ERROR echoes in lock helpers go to `>&2`; after reservation require
   `[[ $report_num =~ ^[0-9]{3,}$ ]]` or mark the offer failed and continue.
5. (N36) Final exit status 1 when any row is `failed` or still `processing`; either implement the
   pre-screen gate with `log_discard` or remove the helper and mark the gate "interactive pipeline
   only" in `modes/batch.md` (decide in the PR; the doc must match the code).
6. (N37) CV artifacts named `cv-candidate-{slug}-{REPORT_NUM}-{DATE}` (date last, so the
   dashboard's `rePDFDate` still matches); remove the stray fence and the duplicate
   `## Machine Summary`; align the TSV filename in `batch-prompt.md`/`modes/batch.md` with
   `AGENTS.md` (`{num}-{company-slug}.tsv`). Re-stamp translations if `modes/batch.md` changes.
7. (N43, N44) Remove the unused JD temp file; rate-limit detection greps only the CLI's error
   lines (not the JD/report text); the EXIT trap removes `.resolved-prompt-*.md`; `read` loops use
   `|| [[ -n $line ]]` and strip `\r`; `aggregate-tokens.mjs` sums the usage JSON `claude -p
   --output-format json` emits (switch the runner to that format) or prints "unknown" honestly.

### J. Go dashboard — N38–N42

**Paradigm: one choke point for side effects (open), a parser that mirrors `tracker-parse.mjs`,
table-driven Go tests run in CI.**

1. (N38) Skip rows whose `num` is not an integer; separator detection by structure
   (`^\|(\s*:?-+:?\s*\|)+\s*$`). Alias table generated from `tracker-aliases.json` via
   `go:embed` + JSON decode (deletes the hand copy).
2. (N39) `resolveReportPath` returns "" unless `isSafeRepoRelativePath` (already used by
   `pdf.go`).
3. (N40) `openWithDefaultApp` validates its argument: URLs must parse with scheme `http`/`https`;
   files must be absolute, under `jobberPath`, and end in `.pdf` or `.md`. Replace
   `HasPrefix(u,"http")` call sites with a shared `isWebURL`.
4. (N41) Tab mode only when the line has ≤ 2 `|`; keep empty trailing cells.
5. (N42) Status writer matches the `#` cell or the report-link cell, not any `[N]` in the row, and
   refuses on duplicates; delete `SaveAnonymousStat` (unused, not anonymous); route WARN to a
   status-line message; strip C0/ESC from rendered report text; percent-encode the `file://`
   link; `gofmt`.
6. Tests: `career_test.go` table tests for separator rows, tab-in-notes rows, traversal links;
   `open_test.go` for the allowlist (controls: a normal https URL and a report `.md` open).

---

## 4. Sequencing

| PR | Workstream | Depends on | Why this order |
|----|------------|------------|----------------|
| 1 | B (proxy + `-H 127.0.0.1` + `/api/run` validation only) | — | Closes the remote entry point to file writes and shell; smallest high-value diff |
| 2 | A (shared primitives) | — | Everything below imports these |
| 3 | C (apply driver) | 2 (net-guard) | Product rule: never submit |
| 4 | D (updater + plugins) | 2 | User-data overwrite and code-execution paths |
| 5 | E (tracker writers) | 2 | Data loss in the tracker and CV |
| 6 | B (rest: file writers, agent policy, tests) | 1 | Completes the web boundary |
| 7 | F (scanner filters) | 2 | Wrong results, incl. shipped template defaults |
| 8 | H (providers) | 2 | Large but mechanical; contract test lands with it |
| 9 | G (freehire-era code) | 2 | Own recent code, small |
| 10 | I (batch runner) | — | Independent shell work |
| 11 | J (Go dashboard) | — | Independent; CI-only verification |

PRs 10 and 11 touch disjoint files and can run in parallel with anything. Each PR: issue first
(repo convention), CI green on all three OS, merge commit.

## 5. Not covered / to verify during implementation

- Next 16 behaviour was read from upstream source at tag `v16.2.12` (no local `node_modules/next`);
  re-check after any Next upgrade.
- jobstreet market paths, `join.mjs` minor units and `agentic-jobs` salary period need one live
  check each before changing behaviour.
- Non-Claude CLI sandbox flags (codex, gemini, opencode, copilot, qwen, agy) are unverified; until
  they are, the tool-scoped web routes accept only Claude.
- No end-to-end run of the web app, the batch runner or the dashboard was performed during the
  audit; each workstream's PR must include one manual smoke run and say so.
- `scan.mjs` lines 900–1690 and 2460–2729 were read only through targeted greps.
