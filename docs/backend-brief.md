# Hosted backend: design brief

Status: shaped, not built. Decisions marked **(user)** were chosen by you. Everything else is a recommendation.

## 1. Job

Serve `site/` and one API endpoint on a VPS. A visitor uploads a CV, picks one of four tasks, and gets a result. The CV is processed and discarded, with no accounts. This must stay true in the code, because the landing page already says so.

## 2. Decisions

| Decision | Choice |
|---|---|
| Host | VPS (user) |
| LLM provider | OpenRouter, one server-side key (user) |
| Isolation | Throwaway temp folder per request, existing scripts run as child processes (user) |
| Abuse control | Per-visitor daily limit (salted IP hash) + global daily spend cap + Cloudflare Turnstile bot check (user) |
| Server code | Plain Node, `node:http`, no framework. Counters in `node:sqlite`. Matches the vanilla front end and the repo's Node 18+ scripts (recommended) |
| TLS and proxy | Caddy in front, serving `site/` statically and proxying `/api/*` to Node (recommended) |

## 3. API contract (what `site/app.js` already sends)

`POST /api/evaluate`, `multipart/form-data`

| Field | Value |
|---|---|
| `cv` | file, `.pdf`, `.md` or `.txt`, at most 5 MB |
| `task` | `score`, `gap`, `pdf` or `scan` |
| `job` | pasted job text, at least 80 characters. Absent for `scan` |
| `cf-turnstile-response` | bot-check token, single use; the page resets the widget after every submit |

Responses: `200` result, `400` bad input, `403` bot check failed, `413` too large, `415` unsupported type, `422` unreadable PDF, `429` this visitor used today's checks, `503` bot check unreachable, budget used up, kill switch on, task not built, or store full. Every error carries a plain-language `error` message that the page shows.

**Result delivery (user: short retention).** The existing `200 {resultUrl}` contract in `app.js` stays. The server keeps the finished result, not the CV, for a short window so the visitor can reload or reopen the link.

- The CV and the temp folder are deleted as soon as the task ends, as in section 4. Only the output (score report, gap list, PDF bytes, scan list) is retained.
- Held in server memory only. Never written to disk, never logged. A restart loses it, which is acceptable.
- Window: 30 minutes from creation, then deleted (confirmed by user). One config value. The page copy must state the same number.
- The URL carries an unguessable token (at least 128 random bits). No listing endpoint, no sequential ids. Responses send `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- Anyone holding the link can read the result until it expires. The page must say so, so visitors do not paste it publicly.
- Cap total retained results by count and bytes. When full, refuse new work with 503 instead of evicting a visitor's live result.
- A visitor can delete their result early with a "Delete this result" button (`DELETE` on the same URL).

## 3b. Abuse controls as built (step 2)

Code: `server/limits.mjs`, `server/turnstile.mjs`, wiring in `server/index.mjs`. Needs Node 22.13 or newer (`node:sqlite`).

- **Order in `/api/evaluate`:** kill switch, body cap, parse, cheap input checks, Turnstile, budget reservation, visitor over-limit check, CV parse, count one check, run the task. A rejected upload (415, 422) and bad input (400) do not use a check. The Turnstile token is consumed by any request that gets that far.
- **Bot check:** Cloudflare receives only the secret and the token (no IP, no CV, no job text). Unreachable or empty means fail closed.
- **Daily limit:** per visitor per UTC day. A visitor is an HMAC of the IP under a key derived from the day, so it cannot be linked across days. IPv6 collapses to its /64. Check-and-count is synchronous, so concurrent requests cannot both pass. Rows from earlier days are deleted. Stored in `server/data/limits.db` (gitignored).
- **Client IP:** the socket address, or the last `X-Forwarded-For` entry only when `JOBBER_TRUST_PROXY=1` (set it only behind Caddy, and make sure Caddy overwrites the header).
- **Spend cap:** a task reserves its worst-case cost (`MAX_COST_USD`) before it runs and settles the actual cost after. In-flight reservations count, so parallel requests cannot overshoot. Over the cap returns 503. Free tasks (`gap`) are never blocked. Today no task costs money; `score` and `pdf` must fill in `MAX_COST_USD` and return real `costUsd`.
- **Kill switch:** create the file named by `JOBBER_KILL_FILE` and every request gets 503 at once; delete it to restore.
- **Production config:** the server refuses to start unless `TURNSTILE_SECRET`, `JOBBER_HASH_SECRET` (32+ characters), `JOBBER_DAILY_LIMIT` and `JOBBER_DAILY_BUDGET_USD` are set. `JOBBER_DEV=1` skips that for local runs. No default numbers exist: you choose them.
- **Deploy step:** set the Turnstile site key in `<meta name="jobber-turnstile">` in `site/index.html`. It is empty in the repo. Add `challenges.cloudflare.com` to the Content-Security-Policy when that is written.
- **Known limits:** limits are per IP, so shared networks share a quota and a visitor with many IPs gets more. Verified in the browser with Cloudflare's published test keys: widget renders, token verifies, third check is refused.

## 3c. Score task as built (step 3)

Code: `server/score.mjs`, wired in `server/index.mjs`. Off unless `OPENROUTER_API_KEY` is set.

- **Method:** the same system prompt as `openai-eval.mjs` (`modes/_shared.md` + `modes/oferta.md`, operating rules adjusted for a hosted, no-tools run). Blocks A to G plus the `---SCORE_SUMMARY---` block, parsed with the shared `eval-runner.mjs` helpers. No profile is sent, and the prompt says so.
- **No temp folder or child process:** the task is one HTTPS call with the CV text held in memory, so the CV never touches disk. The temp-folder design applies to `pdf` and `scan` only if they need files.
- **Injection:** CV and job text go in the user message between random per-request markers, labelled untrusted. The result page builds DOM nodes from text only (tiny Markdown subset: headings, lists, tables, bold, code; no links or HTML). Checked with a hostile report in the browser.
- **Privacy routing:** every request sends `provider.data_collection: "deny"`, plus `zdr: true` when `JOBBER_OPENROUTER_ZDR=1`. If no matching provider exists the call fails and we never retry without the restriction. This depends on OpenRouter honouring it and providers declaring their policies truthfully, so the site text says "we ask", not "we guarantee".
- **Cost:** `provider.max_price` caps per-token price, so the reserved worst case (prompt-token upper bound times the prompt price, plus `max_tokens` times the completion price) is a real bound. The actual cost is read from `usage.cost`; if it is missing, the full reservation is charged. OpenRouter's docs call `usage.cost` "credits" without defining the unit; I assumed 1 credit = 1 US dollar, which you should confirm against your OpenRouter dashboard on the first paid requests.
- **Limits:** CV text up to 30,000 characters, job text up to 20,000 (400 with a reason). A failed upstream call returns 503, costs nothing, and gives the check back.
- **Config:** `OPENROUTER_API_KEY`, `JOBBER_SCORE_MODEL`, `JOBBER_SCORE_MAX_PRICE_PROMPT`, `JOBBER_SCORE_MAX_PRICE_COMPLETION` (USD per million tokens). No default model or price: you choose them.
- **Before launch (yours):** in the OpenRouter account privacy settings, leave prompt logging off and do not opt in to training or discount programmes; check that the chosen model has at least one provider that passes `data_collection: "deny"` (and `zdr` if you enable it); pick the model and price caps; run a few real requests and compare `usage.cost` with the dashboard. Not tested against the live API in this build.

## 3d. PDF task as built (step 4)

Code: `server/pdf.mjs` (task), `server/render-pdf.mjs` (Chromium and queue), `server/openrouter.mjs` (the OpenRouter call, now shared with score). On whenever the score task is, unless `JOBBER_PDF_ENABLED=0`.

- **Flow:** one model call returns a JSON payload (never HTML), `verifyPayload` removes what the CV does not support, `build-cv-html.mjs` (`renderHtml`, now exported; the CLI only runs as a script) fills Jobber's own ATS-safe template, Chromium prints it. The existing `openai-tailor.mjs` full-HTML path is not used.
- **Anti-fabrication, mechanical:** the name must be in the CV (else 422, no PDF). Email, phone, location and links must appear in the CV. A job needs its employer and title in the CV and every year in its dates. Skills, schools, certifications and projects must appear in the CV. Any number in a summary, bullet or description must appear in the CV. Competencies need their words in the CV. Everything removed is listed on the result page. Bullet wording cannot be checked mechanically, so the page says to read every line. No photo is ever added.
- **Chromium:** a fresh browser per render, JavaScript off, offline, every request aborted except `data:` (fonts are inlined), 30 s timeout, closed in `finally`. Only `JOBBER_PDF_CONCURRENCY` (default 1) renders run at once; `JOBBER_PDF_QUEUE` (default 4) may wait; beyond that 503. `check()` refuses when the line is full, before the model is paid. `JOBBER_CHROMIUM_NO_SANDBOX=1` only if Chromium cannot sandbox in the container.
- **Cost on late failure:** `TaskError` now carries `costUsd`. If the model was paid and the reply is unusable, the name is missing, or the render fails, the visitor keeps the check but the spend cap still counts the money.
- **Result:** `{task:'pdf', filename, pdf (base64), pages, atsFindings, removed}`. The result page turns it into a Blob download. It sits in the in-memory store for 30 minutes like other results (about 20 KB base64).
- **Config:** model and price caps default to the score ones (`JOBBER_PDF_MODEL`, `JOBBER_PDF_MAX_PRICE_PROMPT`, `JOBBER_PDF_MAX_PRICE_COMPLETION`); `JOBBER_PDF_FORMAT` is `a4` (default) or `letter`. Install Chromium on the VPS with `npx playwright install --with-deps chromium`.
- **Not tested here:** a live OpenRouter call, quality of the tailoring across real CVs, non-Latin CVs (the template has CSS for en, es, zh-CN, ja, ar; other languages fall back to en), load with several concurrent renders.

## 3e. Scan task as built (step 5)

Code: `server/scan.mjs`, wired in `server/index.mjs`. On unless `JOBBER_SCAN_ENABLED=0`. No LLM, no key, no cost.

- **Design:** a background job index, not a live scan per visitor. At startup and every `JOBBER_SCAN_REFRESH_HOURS` (6) the server fetches a fixed list of company boards through the existing `providers/greenhouse|lever|ashby.mjs` (4 at a time, 250 ms spacing per host, 20 s per board). A request only filters the in-memory index, so visitors cause no outbound traffic and cannot aim the server at any URL. A total outage keeps the last good index.
- **Source list:** `JOBBER_SCAN_SOURCES`, default `templates/portals.example.yml` (system layer, not your personal `portals.yml`): 84 supported boards today. It is mostly AI and tech companies, so results for other fields will be thin. The result page says so. Widening it is a list edit: any portals-shaped YAML with `tracked_companies` entries that carry an `api:` or `careers_url:` on those three boards.
- **Inputs:** two optional form fields, `roles` (comma-separated) and `location`. With no roles, titles are taken from the CV by pattern (a capitalised phrase ending in Engineer, Analyst, Manager and similar; seniority words dropped) and shown on the result so the visitor can correct them. English-title CVs work best. If nothing is found the visitor is asked to type roles.
- **Matching:** every word of a term must be in the posting title (plural tolerant); more matched terms rank first; location is a substring match on the posting's location text; 40 shown, true total reported. Titles only, so a role phrased differently is missed.
- **Safety:** only `https` posting URLs are kept, the result page links them with `rel="noopener noreferrer"`, and all text is set with `textContent`. Roles and location are never logged.
- **Plumbing:** tasks may now set `needsJob: false`; `check`, `maxCostUsd` and `run` receive a third `extra = {roles, location}` argument; `check` may return `{status, error}` (used for "index still loading": 503, check kept).
- **Not covered:** the index is rebuilt after each restart, so for a few minutes after deploy scans return 503. Postings can be closed by the time a visitor clicks (the page says to check). Per-board politeness beyond the provider limits, and ATS terms-of-use review, are yours before launch.
- **Also fixed:** `[hidden]` CSS rule, because `.field { display: grid }` kept hidden fields visible.

## 4. Request flow

1. Reject early: wrong method, body over 5 MB, missing fields. Nothing is read from disk yet.
2. Verify the Turnstile token with Cloudflare (a server-to-server call). Fail closed.
3. Check the limits: per-visitor count for today and the global spend counter. A visitor's count is keyed by `SHA-256(salt_of_the_day + ip)`. The salt rotates daily, so counts cannot be linked across days and no raw IP is stored. Count the attempt before doing work, so retries cannot bypass it.
4. Validate the file by content, not by name: `%PDF-` header for PDF, valid UTF-8 for text. Reject anything else with 415.
5. Create a temp folder on tmpfs (`/dev/shm/jobber-<random>`), write that visitor's `cv.md` and a minimal profile, copy in the mode files the script needs.
6. Run the task script as a child process with a hard timeout, no inherited environment except what it needs (the OpenRouter key, scoped), and the temp folder as its working directory.
7. Read the output, store it in the in-memory result store under a random token, return `{resultUrl}`, and delete the folder in a `finally` block. A sweeper at startup and every few minutes deletes any folder older than 10 minutes, so a crash cannot leave a CV on disk.
8. Update the spend counter from the token usage the script already reports (`lib/token-tracker.mjs`).

## 5. What exists and what does not

| Task | Reusable code | Gap |
|---|---|---|
| `gap` | `jd-skill-gap.mjs` exports `extractJdSkills`, `classifySkillGaps`. No LLM, no network | CV must be parsed to the markdown shape it expects (`cv.md` with a Skills section). PDF text extraction exists in `lib/pdf-text.mjs` |
| `score` | `eval-runner.mjs`, `gemini-eval.mjs`, `openai-eval.mjs`, `lib/llm-providers.mjs`. `openrouter-runner.mjs` has an `evaluate` command | Runners are CLI scripts bound to project-root paths and write reports and tracker files. Evaluate by pasted text is interactive only in the OpenRouter runner. Needs a thin non-interactive wrapper per request |
| `pdf` | `generate-pdf.mjs` (Playwright), `openai-tailor.mjs`, `templates/cv-template.html` | No OpenRouter tailoring path found. Needs checking whether `openai-tailor.mjs` works through OpenRouter's OpenAI-compatible endpoint. Chromium per request is heavy |
| `scan` | `scan.mjs`, `scan-ats-full.mjs`, `portals.yml` | The scan needs a target (roles, location). The form does not ask for it. Recommended: add two optional text fields for the scan task, and derive `portals.yml` filters from them. Public feeds are fetched server-side, so this task needs egress rules and rate limits |

## 6. Risks that change the design

1. **OpenRouter free models may log prompts.** `openrouter-runner.mjs` is written around free models with automatic fallback. Free models commonly come with weaker data terms. The hosted path must use paid models and set OpenRouter's provider routing to exclude providers that collect or train on prompts (it has a `data_collection` and a zero-data-retention option; verify the exact current setting names and per-model availability in its docs before relying on them). Without this, "not stored" would be false at the provider.
2. **The page names no provider.** Say "a third-party AI model provider" today. With OpenRouter the CV text passes through OpenRouter and then to the model's own provider. The privacy text must say so plainly.
3. **Prompt injection.** CV and job text are untrusted. These runners do plain text completion with no tools, which limits the damage, but output must be rendered as text, never as HTML.
4. **Logs.** Never log bodies, CV text, job text, results, or raw IPs. Log task, status, duration, token counts and the daily hashed bucket only.
5. **Cost runaway.** The global spend cap is the only real protection. It must read actual token usage and fail closed (return 503 and show a plain message) when reached. Set a per-request output limit (`MAX_OUTPUT_TOKENS` already exists) and a per-request timeout.
6. **PDF generation memory.** Run at most one or two Chromium jobs at once, queue the rest, and show the visitor a wait message. A small VPS will fall over without this.
7. **Turnstile adds a third party** to every submit and a script to the page. Disclose it in the privacy text and the Content-Security-Policy.
8. **Retained results are personal data.** A score report or tailored CV PDF contains CV content for the whole window. The privacy text must say so, with the window length. Include the result store in the post-request leak check, and in the deletion path of any data-subject request.
9. **Legal.** Visitor CVs are personal data. Legal review of the privacy text, OpenRouter's and the upstream model's terms, and a lawful basis is yours to arrange before launch. If you serve UK or EU visitors, UK GDPR or GDPR applies.

## 7. Open decisions for you

1. ~~Result delivery~~ Decided: short retention, in memory only. Window confirmed by user: 30 minutes.
2. Daily limit per visitor, and the global daily spend ceiling in currency. Both configurable; no values invented here.
3. Which OpenRouter model for score and for tailoring. Needs a price and quality check; this brief does not guess prices.
4. Scan inputs: add target role and location fields to the form (recommended).
5. VPS size and OS (the Playwright image in the repo `Dockerfile` is large and carries Go and TeX; a smaller image or direct install is likely better).
6. Domain and Turnstile site key.

## 8. Build order

1. Server skeleton: static serving, `/api/evaluate` validation, upload checks, temp-folder lifecycle and sweeper, limits table, no-body logging. Ship `gap` end to end here, since it needs no key and proves the plumbing.
2. ~~Turnstile, daily limit, global cap, 503 kill switch~~ Done (section 3b).
3. ~~`score` through OpenRouter with the privacy routing settings, spend accounting~~ Done (section 3c).
4. ~~`pdf` with the concurrency queue~~ Done (section 3d).
5. ~~`scan`~~ Done (section 3e).
6. Hardening: CSP, load test, kill-switch drill, a check that no CV bytes remain on disk or in logs after a request, and the legal review.

Tests follow the repo's existing style (`test-all.mjs`): each assertion must be able to fail, for example uploading a file with a `.pdf` name and non-PDF bytes must return 415, and a failed child process must still delete its temp folder.
