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
| `cf-turnstile-response` | bot-check token. Not yet sent by the page |

Responses: `200` result, `413` too large, `415` unsupported type, `429` daily limit or spend cap reached, `400` bad input with a plain-language message, `503` tool switched off for the day, `5xx` anything else.

**Result delivery (user: short retention).** The existing `200 {resultUrl}` contract in `app.js` stays. The server keeps the finished result, not the CV, for a short window so the visitor can reload or reopen the link.

- The CV and the temp folder are deleted as soon as the task ends, as in section 4. Only the output (score report, gap list, PDF bytes, scan list) is retained.
- Held in server memory only. Never written to disk, never logged. A restart loses it, which is acceptable.
- Window: 30 minutes from creation, then deleted (confirmed by user). One config value. The page copy must state the same number.
- The URL carries an unguessable token (at least 128 random bits). No listing endpoint, no sequential ids. Responses send `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- Anyone holding the link can read the result until it expires. The page must say so, so visitors do not paste it publicly.
- Cap total retained results by count and bytes. When full, refuse new work with 503 instead of evicting a visitor's live result.
- A visitor can delete their result early with a "Delete this result" button (`DELETE` on the same URL).

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
2. Turnstile, daily limit, global cap, 503 kill switch.
3. `score` through OpenRouter with the privacy routing settings, spend accounting.
4. `pdf` with the concurrency queue.
5. `scan`.
6. Hardening: CSP, load test, kill-switch drill, a check that no CV bytes remain on disk or in logs after a request, and the legal review.

Tests follow the repo's existing style (`test-all.mjs`): each assertion must be able to fail, for example uploading a file with a `.pdf` name and non-PDF bytes must return 415, and a failed child process must still delete its temp folder.
